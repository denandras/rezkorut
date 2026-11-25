import Stripe from "stripe";

/**
 * Stripe product/price helpers for ticket types.
 *
 * One Stripe Product + one active Price per ticket type, keyed by a
 * deterministic lookup key `rk:<concert_id>:<slug(name)>-<n>` so the upsert is
 * idempotent: re-PUTting the same types reuses the existing price, a price
 * change transfers the lookup key to a replacement price and deactivates the
 * old one, and removed types get their price deactivated — never deleted.
 *
 * Server-only: reads STRIPE_SECRET_KEY from the environment and never returns
 * it. Creating products/prices is inert (no money moves); Checkout Sessions are
 * created elsewhere (card 03), never here.
 */

let cached: Stripe | null = null;

export type StripeMode = "test" | "live";

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return cached;
}

/** Reports which mode STRIPE_SECRET_KEY points to (never the key itself). */
export function getStripeMode(): StripeMode | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return key.startsWith("sk_live_") ? "live" : "test";
}

function requireStripe(): Stripe {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("[stripe-tickets] STRIPE_SECRET_KEY is not configured");
  }
  return stripe;
}

/** Ascii-folded slug of a ticket type name (same folding style as lib/concert-admin). */
function slugify(value: string): string {
  const folded = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o")
    .replace(/ű/g, "u")
    .replace(/[^a-z0-9]+/g, "-");
  return folded.replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
}

/**
 * The deterministic lookup key for the n-th type (1-based) of a concert:
 * `rk:<concert_id>:<slug(name)>-<n>`.
 */
export function typeLookupKey(concertId: string, name: string, indexOneBased: number): string {
  return `rk:${concertId}:${slugify(name)}-${indexOneBased}`;
}

/** Product display name: `Réz körút – <concert title> – <type>`. */
function productName(concertTitle: string, typeName: string): string {
  return `Réz körút – ${concertTitle} – ${typeName}`;
}

function productIdOfPrice(price: Stripe.Price): string | null {
  const product = price.product;
  if (typeof product === "string") return product;
  if (product && typeof product === "object" && "id" in product) return product.id;
  return null;
}

function metadataMatches(
  metadata: Stripe.MetadataParam | null | undefined,
  expected: { concert_id: string; ticket_type_id: string },
): boolean {
  return (
    metadata?.concert_id === expected.concert_id &&
    metadata?.ticket_type_id === expected.ticket_type_id
  );
}

export type UpsertTypePriceResult = {
  productId: string;
  priceId: string;
  lookupKey: string;
};

/**
 * Ensures a Stripe Product + active Price exist for one ticket type under the
 * given lookup key, with `unit_amount = priceHuf * 100` fillér, `currency:
 * "huf"` and metadata `{concert_id, ticket_type_id}`. Idempotent:
 * - matching active price → reused (product name/metadata refreshed);
 * - same amount but drifted metadata/lookup key → price updated in place;
 * - changed amount or inactive holder → replacement price created with
 *   `transfer_lookup_key` (the key moves), old price deactivated.
 */
export async function upsertTypePrice(input: {
  concertId: string;
  concertTitle: string;
  typeName: string;
  ticketTypeId: string;
  lookupKey: string;
  priceHuf: number;
}): Promise<UpsertTypePriceResult> {
  const stripe = requireStripe();
  const unitAmount = input.priceHuf * 100;
  const metadata: { concert_id: string; ticket_type_id: string } = {
    concert_id: input.concertId,
    ticket_type_id: input.ticketTypeId,
  };

  const found = await stripe.prices.list({ lookup_keys: [input.lookupKey], limit: 10 });
  const current = found.data[0] ?? null;

  if (current) {
    const productId = productIdOfPrice(current);
    if (!productId) {
      throw new Error(`[stripe-tickets] Price ${current.id} has no usable product reference`);
    }

    const reusable =
      current.active &&
      current.currency === "huf" &&
      current.unit_amount === unitAmount &&
      metadataMatches(current.metadata, metadata);

    if (reusable) {
      await stripe.products.update(productId, {
        name: productName(input.concertTitle, input.typeName),
        metadata,
      });
      return { productId, priceId: current.id, lookupKey: current.lookup_key ?? input.lookupKey };
    }

    if (
      current.active &&
      current.currency === "huf" &&
      current.unit_amount === unitAmount &&
      current.lookup_key === input.lookupKey
    ) {
      // Right price, drifted metadata: fix it in place instead of recreating.
      await stripe.prices.update(current.id, { metadata });
      await stripe.products.update(productId, {
        name: productName(input.concertTitle, input.typeName),
        metadata,
      });
      return { productId, priceId: current.id, lookupKey: input.lookupKey };
    }

    // Changed amount (or inactive holder): move the lookup key to a new price,
    // then retire the old price. Never delete anything.
    const created = await stripe.prices.create({
      product: productId,
      unit_amount: unitAmount,
      currency: "huf",
      lookup_key: input.lookupKey,
      transfer_lookup_key: true,
      metadata,
    });
    if (current.active) {
      await stripe.prices.update(current.id, { active: false });
    }
    await stripe.products.update(productId, {
      name: productName(input.concertTitle, input.typeName),
      metadata,
    });
    return { productId, priceId: created.id, lookupKey: input.lookupKey };
  }

  // No price holds the key yet: create the product, then its price.
  const product = await stripe.products.create({
    name: productName(input.concertTitle, input.typeName),
    metadata,
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "huf",
    lookup_key: input.lookupKey,
    metadata,
  });
  return { productId: product.id, priceId: price.id, lookupKey: input.lookupKey };
}

/**
 * Deactivates the Stripe price of a removed ticket type (never deletes it).
 * No-op when there is no price id to deactivate.
 */
export async function deactivateTypePrice(priceId: string | null | undefined): Promise<void> {
  if (!priceId) return;
  const stripe = requireStripe();
  await stripe.prices.update(priceId, { active: false });
}
