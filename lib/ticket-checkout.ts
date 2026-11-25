import Stripe from "stripe";

import {
  getConcert,
  getTicketDb,
  getTicketTypes,
  type RkOrder,
  type RkTicketType,
} from "@/lib/ticket-db";

/**
 * Public checkout pipeline (card 03): validate the cart against the DB, insert
 * the pending `rk_orders` row, create the Stripe Checkout Session, store its
 * id, return the hosted-url.
 *
 * Server-only: reads the service-role Supabase client and the Stripe client;
 * the amount is ALWAYS recomputed from `rk_ticket_types` — a client-supplied
 * price is never read, never trusted.
 *
 * The function takes the Stripe client as an argument (instead of calling
 * `getStripeClient()` itself) so the verification harness can drive the exact
 * production code path with a stubbed client — the live key never creates a
 * real Checkout Session during tests. Node type-stripping compatibility: no
 * parameter properties, no enums (scripts import this file directly).
 */

export const MAX_TOTAL_QUANTITY = 6;
export const MIN_CHARGE_HUF = 200;

/** Error with an HTTP status and a machine-readable code for the front-end. */
export class CheckoutError extends Error {
  status: number;
  code: string;
  ticketType?: string;

  constructor(status: number, code: string, message: string, ticketType?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.ticketType = ticketType;
  }
}

export type CheckoutItem = {
  ticket_type_id: string;
  quantity: number;
};

export type CheckoutBuyer = {
  name: string;
  email: string;
  phone: string;
  address: { postal_code: string; city: string; street: string };
};

export type CheckoutRequest = {
  concert_id: string;
  items: CheckoutItem[];
  buyer: CheckoutBuyer;
  accept_terms: boolean;
};

/** Validates the JSON body shape. `accept_terms` is checked by the route. */
export function parseCheckoutRequest(raw: unknown): { request: CheckoutRequest } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "Hibás kérés." };
  const body = raw as Record<string, unknown>;

  if (typeof body.concert_id !== "string" || body.concert_id.trim().length === 0) {
    return { error: "Hiányzó koncert-azonosító." };
  }
  const concertId = body.concert_id.trim();

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { error: "A kosár nem lehet üres." };
  }
  const items: CheckoutItem[] = [];
  let totalQuantity = 0;
  for (const entry of body.items) {
    if (typeof entry !== "object" || entry === null) return { error: "Hibás kosár-tétel." };
    const item = entry as Record<string, unknown>;
    if (typeof item.ticket_type_id !== "string" || item.ticket_type_id.trim().length === 0) {
      return { error: "Hiányzó jegytípus-azonosító." };
    }
    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_TOTAL_QUANTITY
    ) {
      return { error: "A darabszám 1 és 6 közötti egész szám lehet." };
    }
    const existing = items.find((candidate) => candidate.ticket_type_id === item.ticket_type_id);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      items.push({ ticket_type_id: item.ticket_type_id.trim(), quantity: item.quantity });
    }
    totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity > MAX_TOTAL_QUANTITY) {
      return { error: `Kosáronként legfeljebb ${MAX_TOTAL_QUANTITY} jegy vásárolható.` };
    }
  }

  if (typeof body.buyer !== "object" || body.buyer === null) return { error: "Hiányzó vásárlói adatok." };
  const buyerRaw = body.buyer as Record<string, unknown>;
  if (typeof buyerRaw.name !== "string" || buyerRaw.name.trim().length < 2 || buyerRaw.name.trim().length > 100) {
    return { error: "A név megadása kötelező (2–100 karakter)." };
  }
  if (
    typeof buyerRaw.email !== "string" ||
    !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(buyerRaw.email.trim()) ||
    buyerRaw.email.trim().length > 200
  ) {
    return { error: "Érvényes e-mail-cím megadása kötelező." };
  }
  const phone = typeof buyerRaw.phone === "string" ? buyerRaw.phone.trim() : "";
  if (phone.length > 30) return { error: "A telefonszám túl hosszú." };
  if (
    typeof buyerRaw.address !== "object" ||
    buyerRaw.address === null
  ) {
    return { error: "Hiányzó számlázási cím." };
  }
  const addressRaw = buyerRaw.address as Record<string, unknown>;
  if (typeof addressRaw.postal_code !== "string" || addressRaw.postal_code.trim().length < 1 || addressRaw.postal_code.trim().length > 10) {
    return { error: "Az irányítószám megadása kötelező." };
  }
  if (typeof addressRaw.city !== "string" || addressRaw.city.trim().length < 1 || addressRaw.city.trim().length > 60) {
    return { error: "A város megadása kötelező." };
  }
  if (typeof addressRaw.street !== "string" || addressRaw.street.trim().length < 1 || addressRaw.street.trim().length > 120) {
    return { error: "Az utca, házszám megadása kötelező." };
  }

  return {
    request: {
      concert_id: concertId,
      items,
      buyer: {
        name: buyerRaw.name.trim(),
        email: buyerRaw.email.trim().toLowerCase(),
        phone,
        address: {
          postal_code: addressRaw.postal_code.trim(),
          city: addressRaw.city.trim(),
          street: addressRaw.street.trim(),
        },
      },
      accept_terms: body.accept_terms === true,
    },
  };
}

export type CheckoutSessionResult = {
  url: string;
  sessionId: string;
  orderId: string;
  amountHuf: number;
  lineItems: { priceId: string; quantity: number }[];
};

/**
 * Full server-side checkout: validations against the live DB, pending order
 * inserted, Stripe Checkout Session created, `stripe_session_id` stored.
 * Throws {@link CheckoutError} for every client-rejectable condition.
 *
 * Owner decision (2026-11-25): private buyers only — `buyer_company` and
 * `buyer_tax_number` are NEVER written, they stay in the schema untouched.
 */
export async function createOrderAndCheckoutSession(
  stripe: Stripe,
  request: CheckoutRequest,
  baseUrl: string,
): Promise<CheckoutSessionResult> {
  const db = getTicketDb();
  if (!db) {
    throw new CheckoutError(503, "db_not_configured", "A jegykezelés nincs beállítva ezen a szerveren.");
  }

  const concert = await getConcert(request.concert_id);
  if (!concert) {
    throw new CheckoutError(404, "no_concert", "Nincs ilyen koncert.");
  }
  if (concert.status !== "on_sale") {
    throw new CheckoutError(409, "not_on_sale", "A koncert jegyértékesítése nem folyamatban van.");
  }

  const types = await getTicketTypes(request.concert_id);
  const typesById = new Map<string, RkTicketType>(types.map((type) => [type.id, type]));

  const resolved: { type: RkTicketType; quantity: number }[] = [];
  const now = Date.now();
  for (const item of request.items) {
    const type = typesById.get(item.ticket_type_id);
    if (!type) {
      throw new CheckoutError(400, "unknown_ticket_type", "Nincs ilyen jegytípus a koncerten.");
    }
    if (!type.active) {
      throw new CheckoutError(400, "type_inactive", "Ez a jegytípus már nem kapható.", type.name);
    }
    if (type.sales_start && now < Date.parse(type.sales_start)) {
      throw new CheckoutError(400, "outside_sales_window", "Ennek a jegytípusnak az előértékesítése még nem kezdődött el.", type.name);
    }
    if (type.sales_end && now > Date.parse(type.sales_end)) {
      throw new CheckoutError(400, "outside_sales_window", "Ennek a jegytípusnak az előértékesítése már lejárt.", type.name);
    }
    if (!type.stripe_price_id) {
      throw new CheckoutError(500, "price_missing", "A jegytípushoz nem tartozik Stripe-ár.", type.name);
    }
    if (type.capacity !== null && type.sold + item.quantity > type.capacity) {
      throw new CheckoutError(409, "sold_out", "Ebből a jegytípusból már nincs több jegy.", type.name);
    }
    resolved.push({ type, quantity: item.quantity });
  }

  const amountHuf = resolved.reduce((sum, item) => sum + item.type.price_huf * item.quantity, 0);
  if (amountHuf < MIN_CHARGE_HUF) {
    throw new CheckoutError(400, "amount_below_minimum", "A fizetendő összeg legalább 200 forint.");
  }

  // Pending order first (buyer snapshot — deliberately WITHOUT company name
  // and tax number: private buyers only, those columns are never written).
  const { data: order, error: insertError } = await db
    .from("rk_orders")
    .insert({
      concert_id: concert.concert_id,
      buyer_name: request.buyer.name,
      buyer_email: request.buyer.email,
      buyer_phone: request.buyer.phone || null,
      address_postal: request.buyer.address.postal_code,
      address_city: request.buyer.address.city,
      address_street: request.buyer.address.street,
      amount_huf: amountHuf,
      currency: "HUF",
      status: "pending",
    })
    .select()
    .single();
  if (insertError || !order) {
    throw new Error(`[ticket-checkout] rk_orders insert failed: ${insertError?.message ?? "unknown error"}`);
  }

  const lineItems = resolved.map((item) => ({
    priceId: item.type.stripe_price_id as string,
    quantity: item.quantity,
  }));

  const base = baseUrl.replace(/\/+$/, "");
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: lineItems.map((item) => ({ price: item.priceId, quantity: item.quantity })),
    customer_creation: "always",
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
    consent_collection: { terms_of_service: "required" },
    locale: "hu",
    client_reference_id: (order as RkOrder).id,
    metadata: {
      order_id: (order as RkOrder).id,
      concert_id: concert.concert_id,
    },
    payment_intent_data: {
      metadata: { order_id: (order as RkOrder).id },
    },
    success_url: `${base}/jegyek/koszonjuk?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/jegyek/${concert.concert_id}?canceled=1`,
  };

  const session = await stripe.checkout.sessions.create(params);

  const { error: updateError } = await db
    .from("rk_orders")
    .update({ stripe_session_id: session.id })
    .eq("id", (order as RkOrder).id);
  if (updateError) {
    throw new Error(`[ticket-checkout] stripe_session_id update failed: ${updateError.message}`);
  }

  return {
    url: session.url ?? "",
    sessionId: session.id,
    orderId: (order as RkOrder).id,
    amountHuf,
    lineItems,
  };
}
