import Stripe from "stripe";

import {
  getDiscountCodeByCode,
  getTicketTypes,
  insertDiscountCode,
  setDiscountCodeActive,
  type RkDiscountCode,
} from "@/lib/ticket-db";

/**
 * Kedvezménykódok (card 12) — Stripe Promotion Codes as the engine.
 *
 * One row = one Stripe coupon (percent_off or amount_off + currency huf) +
 * one promotion code (the string the buyer types, max_redemptions,
 * expires_at, active). Stripe validates and applies the discount at
 * checkout; we store only what we need (the ids, the code, our own
 * redemption counter) and keep the invoicing correct.
 *
 * Codes are IMMUTABLE once created: the coupon of an existing code cannot be
 * changed. Deactivating flips `active` on both Stripe objects and the row;
 * history is never deleted.
 *
 * The buy-flow validation (unknown/inactive/expired/exhausted → Hungarian
 * message, no session) lives in lib/ticket-checkout.ts next to the rest of
 * the checkout pipeline — this module stays the dashboard's engine.
 *
 * Node type-stripping compatibility: no parameter properties, no enums (the
 * verification harness imports this file directly).
 */

/** Card 12: the buyer-typed code — 3–24 chars, A–Z 0–9 and `-`, uppercase. */
export const DISCOUNT_CODE_RE = /^[A-Z0-9-]{3,24}$/;

/** Upper-case normalization of a buyer/operator-typed code. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Create validation (the dashboard's save)
// ---------------------------------------------------------------------------

export type DiscountCodeCreateInput = {
  /** Already normalized (uppercase). */
  code: string;
  /** 1–100; null when the discount is a fixed amount. */
  percent_off: number | null;
  /** Whole forints, ≥ 100; null when the discount is a percent. */
  amount_off_huf: number | null;
  /** Null = unlimited. */
  max_redemptions: number | null;
  /** ISO timestamp or null (never expires). */
  expires_at: string | null;
  /** Null = minden koncertre; a concert id = scoped to that concert. */
  concert_id: string | null;
};

/**
 * Parses + validates the create form's payload. Every rule from the card:
 * 3–24 chars, A–Z 0–9 and `-`, uppercase, unique; exactly one of percent
 * (1–100) or amount (100–price); the negative-price refusal is checked
 * against the concert's active paid types when the code is scoped to a
 * concert (a global code has no single price to check — the checkout-side
 * validation refuses it there with the same message).
 *
 * Returns `{ input }` or `{ error }` with the Hungarian message for the UI.
 */
export async function parseDiscountCodeCreate(
  raw: unknown,
): Promise<{ input: DiscountCodeCreateInput } | { error: string }> {
  if (typeof raw !== "object" || raw === null) return { error: "Hibás kérés." };
  const body = raw as Record<string, unknown>;

  // Kód: 3–24 karakter, A–Z 0–9 és `-`, nagybetűs.
  if (typeof body.code !== "string") return { error: "A kedvezménykód megadása kötelező." };
  const code = normalizeDiscountCode(body.code);
  if (!DISCOUNT_CODE_RE.test(code)) {
    return { error: "A kód 3–24 karakter lehet, csak nagybetű, szám és kötőjel." };
  }

  // Százalék VAGY összeg — pontosan az egyik.
  const percentOff = body.percent_off ?? null;
  const amountOff = body.amount_off_huf ?? null;
  if (percentOff !== null && amountOff !== null) {
    return { error: "Csak százalék vagy összeg adható meg, nem mindkettő." };
  }
  if (percentOff === null && amountOff === null) {
    return { error: "Adja meg a kedvezményt százalékban vagy forintban." };
  }
  if (percentOff !== null) {
    if (typeof percentOff !== "number" || !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
      return { error: "A százalékos kedvezmény 1 és 100 közötti egész szám lehet." };
    }
  }
  if (amountOff !== null) {
    if (typeof amountOff !== "number" || !Number.isInteger(amountOff) || amountOff < 100) {
      return { error: "Az összeg szerinti kedvezmény legalább 100 forint, egész szám." };
    }
  }

  // Max. beváltás: null = korlátlan.
  let maxRedemptions: number | null = null;
  if (body.max_redemptions !== undefined && body.max_redemptions !== null && body.max_redemptions !== "") {
    const value = body.max_redemptions;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { error: "A maximális beváltás 1 vagy nagyobb egész szám, vagy üresen hagyható." };
    }
    maxRedemptions = value;
  }

  // Lejárat: null = nincs.
  let expiresAt: string | null = null;
  if (typeof body.expires_at === "string" && body.expires_at.trim().length > 0) {
    const stamp = Date.parse(body.expires_at.trim());
    if (!Number.isFinite(stamp)) {
      return { error: "Érvénytelen lejárat." };
    }
    expiresAt = new Date(stamp).toISOString();
  }

  // Melyik koncertre vagy mindenre: null = minden koncertre.
  let concertId: string | null = null;
  if (typeof body.concert_id === "string" && body.concert_id.trim().length > 0) {
    concertId = body.concert_id.trim();
  }

  // A kód egyedi.
  const existing = await getDiscountCodeByCode(code);
  if (existing) {
    return { error: "Ilyen kedvezménykód már létezik." };
  }

  // Koncertre szóló összeg-kód: a kedvezmény nem teheti negatívvá az árat —
  // a koncert legolcsóbb aktív fizetős jegyára a felső korlát.
  if (concertId !== null && amountOff !== null) {
    const types = await getTicketTypes(concertId);
    const paidPrices = types.filter((type) => type.active && type.price_huf > 0).map((type) => type.price_huf);
    if (paidPrices.length > 0 && amountOff > Math.min(...paidPrices)) {
      return { error: "Az összeg kedvezmény nem lehet nagyobb a koncert legolcsóbb jegyáránál." };
    }
  }

  return {
    input: {
      code,
      percent_off: percentOff,
      amount_off_huf: amountOff,
      max_redemptions: maxRedemptions,
      expires_at: expiresAt,
      concert_id: concertId,
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe writes (create + deactivate)
// ---------------------------------------------------------------------------

export type CreateDiscountCodeResult = {
  row: RkDiscountCode;
  stripeCouponId: string;
  stripePromotionCodeId: string;
};

/**
 * Create = Stripe coupon (`percent_off` or `amount_off` + `currency: huf`) +
 * promotion code (`code`, `max_redemptions`, `expires_at`, `active: true`),
 * then the DB row. Stripe enforces the redemption/expiry rules at checkout;
 * our own validation already rejected everything user-rejectable before this.
 */
export async function createDiscountCode(
  stripe: Stripe,
  input: DiscountCodeCreateInput,
): Promise<CreateDiscountCodeResult> {
  const couponParams: Stripe.CouponCreateParams = {};
  if (input.percent_off !== null) {
    couponParams.percent_off = input.percent_off;
    couponParams.duration = "once";
  } else {
    couponParams.amount_off = input.amount_off_huf as number;
    couponParams.currency = "huf";
    couponParams.duration = "once";
  }
  if (input.max_redemptions !== null) couponParams.max_redemptions = input.max_redemptions;
  if (input.expires_at !== null) couponParams.redeem_by = Math.floor(Date.parse(input.expires_at) / 1000);
  const coupon = await stripe.coupons.create(couponParams);

  const promotionParams: Stripe.PromotionCodeCreateParams = {
    promotion: { type: "coupon", coupon: coupon.id },
    code: input.code,
    active: true,
  };
  if (input.max_redemptions !== null) promotionParams.max_redemptions = input.max_redemptions;
  if (input.expires_at !== null) promotionParams.expires_at = Math.floor(Date.parse(input.expires_at) / 1000);
  const promotionCode = await stripe.promotionCodes.create(promotionParams);

  const row = await insertDiscountCode({
    concert_id: input.concert_id,
    code: input.code,
    stripe_coupon_id: coupon.id,
    stripe_promotion_code_id: promotionCode.id,
    percent_off: input.percent_off,
    amount_off_huf: input.amount_off_huf,
    max_redemptions: input.max_redemptions,
    expires_at: input.expires_at,
  });

  return { row, stripeCouponId: coupon.id, stripePromotionCodeId: promotionCode.id };
}

/**
 * Deactivate = the promotion code `active:false` at Stripe + the row
 * `active:false`. NOTE (API-verified 2026-11-26, stripe-node 22.1.1): a
 * Stripe COUPON has no `active` field at all — CouponUpdateParams accepts
 * only metadata/name/currency_options — so the promotion code is the only
 * redeemable gate to flip, and flipping it is the complete deactivation:
 * with the promotion code inactive the buyer-facing code string can no
 * longer be redeemed (neither through our `discounts` param nor through
 * `allow_promotion_codes`, which only exposes active promotion codes).
 * Reactivating works the same way. History is never deleted.
 */
export async function setDiscountActiveOnStripe(
  stripe: Stripe,
  row: RkDiscountCode,
  active: boolean,
): Promise<void> {
  await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active });
}

/** The full deactivate/activate: Stripe first, then the DB row. */
export async function setDiscountCodeActiveWithStripe(
  stripe: Stripe,
  row: RkDiscountCode,
  active: boolean,
): Promise<RkDiscountCode> {
  await setDiscountActiveOnStripe(stripe, row, active);
  const updated = await setDiscountCodeActive(row.id, active);
  return updated ?? { ...row, active };
}
