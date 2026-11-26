import type Stripe from "stripe";

import { makeCode } from "@/lib/ticket-code";
import {
  getConcert,
  getDiscountCodeByPromotionCodeId,
  getTicketDb,
  getTicketTypes,
  incrementDiscountTimesRedeemed,
  listTicketsForOrder,
  setConcertStatus,
  type RkDiscountCode,
  type RkOrder,
  type RkTicket,
  type RkTicketType,
} from "@/lib/ticket-db";
import { sendTicketEmail, type TicketEmailResult } from "@/lib/ticket-email";

/**
 * Shared fulfilment + refund logic (card 03). This module is the ONLY place
 * that creates `rk_tickets` rows: the Stripe webhook uses it, the free
 * (0 Ft) endpoint uses it (card 11), and any future caller (a manual
 * "re-fetch session" retry path, a resend route) shares it.
 *
 * `fulfilOrder` is idempotent: a paid order that already has tickets is left
 * untouched (webhook replays are a normal Stripe occurrence). The e-mail is
 * sent after the DB writes and its failure never fails the caller —
 * `emailed_at` simply stays null (the resend retry route is a later card).
 *
 * The per-order DB writes (mark paid → create tickets → increment `sold` →
 * flip the concert to `sold_out` → send the e-mail) live in one shared
 * `writeFulfilment` core, so a paid Stripe session and a free order walk the
 * exact same fulfilment path — the card 11 rule that a free ticket gets
 * everything a paid one gets.
 *
 * Node type-stripping compatibility: no parameter properties, no enums
 * (the verification harness imports this file directly).
 */

/**
 * Marker for free (0 Ft) orders (card 11): `stripe_payment_intent` carries the
 * literal `FREE` so a free order is recognisable without new columns. Free
 * orders never touch Stripe — no session, no payment intent, no refund — and
 * every code path that would call Stripe on an order must skip or DB-handle
 * orders carrying this marker.
 */
export const FREE_ORDER_MARKER = "FREE";


function db() {
  const client = getTicketDb();
  if (!client) {
    throw new Error("[ticket-fulfil] Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return client;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getOrderById(orderId: string): Promise<RkOrder | null> {
  const { data, error } = await db().from("rk_orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(`[ticket-fulfil] rk_orders read failed: ${error.message}`);
  return (data as RkOrder | null) ?? null;
}

async function getOrderByPaymentIntent(paymentIntent: string): Promise<RkOrder | null> {
  const { data, error } = await db()
    .from("rk_orders")
    .select("*")
    .eq("stripe_payment_intent", paymentIntent)
    .order("created_at")
    .maybeSingle();
  if (error) throw new Error(`[ticket-fulfil] rk_orders read (by payment_intent) failed: ${error.message}`);
  return (data as RkOrder | null) ?? null;
}

// ---------------------------------------------------------------------------
// Discount allocation (card 12) — invoicing follows the money
// ---------------------------------------------------------------------------

/** What a paid session finalized: the money the buyer actually paid. */
export type SessionPricing = {
  /** `session.amount_total` — whole forints (what Stripe charged). */
  paidHuf: number;
  /** `session.total_details.amount_discount` — whole forints. */
  discountHuf: number;
  /** The code string the buyer typed (ours), the promotion code's code, or null. */
  discountCode: string | null;
  /** Our `rk_discount_codes` row id when the code is ours (times_redeemed +1), else null. */
  discountRowId: string | null;
};

/**
 * Card 12: allocates a paid session's discount across the tickets so each
 * ticket carries its ALLOCATED gross price and the sum equals what the buyer
 * paid EXACTLY:
 *
 *  - no discount → the list prices unchanged;
 *  - with a discount the paid amount is split proportionally to the list
 *    price (`allocated_i = floor(p_i * A / P)`), and the rounding remainder
 *    is forced onto the LAST ticket — the sum equals `paidHuf` exactly,
 *    never the list total.
 *
 * Every allocated price stays ≥ 0 and ≤ its list price; a ticket that
 * allocates to 0 Ft is a free ticket (no invoice — the cron's ticket-level
 * exclusion). Deterministic and pure — the harness verifies the invariant.
 */
export function allocateDiscountGross(listPrices: number[], pricing: SessionPricing): number[] {
  const listTotal = listPrices.reduce((sum, price) => sum + price, 0);
  if (pricing.discountHuf <= 0 || listPrices.length === 0 || listTotal <= 0) {
    return [...listPrices];
  }
  const paid = pricing.paidHuf;
  // Defensive clamps: a real discounted session always has 0 ≤ paid < list
  // total; anything else is a payload mismatch and the list prices are the
  // safer answer (the webhook reads real sessions).
  if (paid < 0 || paid >= listTotal) {
    return [...listPrices];
  }
  const allocated = listPrices.map((price) => Math.floor((price * paid) / listTotal));
  // Remainder forced onto the last ticket so the sum is exact.
  const allocatedSum = allocated.reduce((sum, value) => sum + value, 0);
  allocated[allocated.length - 1] += paid - allocatedSum;
  return allocated;
}

/**
 * Reads the applied promotion code off a (paid) session: its `discounts`
 * array, the promotion code object's own `code` string when the payload
 * carries it, or our DB row matched by the promotion code id. A code applied
 * on the Stripe page (allow_promotion_codes) that is not ours (a foreign
 * promotion code in the account) still attributes honestly: its code string
 * with no `times_redeemed` increment.
 */
async function resolveSessionDiscount(session: Stripe.Checkout.Session): Promise<SessionPricing> {
  const discountHuf = Math.round((session.total_details?.amount_discount ?? 0) / 100);
  const paidHuf = Math.round((session.amount_total ?? 0) / 100);

  let discountCode: string | null = null;
  let discountRowId: string | null = null;
  const attached = session.discounts?.[0]?.promotion_code ?? null;
  if (typeof attached === "string") {
    const row: RkDiscountCode | null = await getDiscountCodeByPromotionCodeId(attached);
    if (row) {
      discountCode = row.code;
      discountRowId = row.id;
    }
  } else if (attached && typeof attached === "object") {
    discountCode = attached.code ?? null;
    const row = attached.id ? await getDiscountCodeByPromotionCodeId(attached.id) : null;
    discountRowId = row?.id ?? null;
  }

  return { paidHuf, discountHuf, discountCode, discountRowId };
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

export type FulfilResult =
  | { outcome: "fulfilled"; orderId: string; tickets: RkTicket[]; email: TicketEmailResult; soldOut: boolean }
  | { outcome: "already_fulfilled"; orderId: string; ticketCount: number }
  | { outcome: "skipped"; orderId: string | null; reason: string };

export type ResolvedUnit = { type: RkTicketType; quantity: number };

function priceIdOfLineItem(lineItem: Stripe.LineItem): string | null {
  if (typeof lineItem.price === "string") return lineItem.price;
  if (lineItem.price && typeof lineItem.price === "object" && "id" in lineItem.price) {
    return lineItem.price.id;
  }
  return null;
}

function priceMetadataOfLineItem(lineItem: Stripe.LineItem): Stripe.Metadata | null {
  if (lineItem.price && typeof lineItem.price === "object" && "metadata" in lineItem.price) {
    return lineItem.price.metadata ?? null;
  }
  return null;
}

/**
 * Maps the session's line items onto the concert's ticket types. Primary key
 * is the Stripe price id the session was created with; if the intern panel
 * replaced that price in the meantime (lookup-key transfer), the price's own
 * metadata (`ticket_type_id`, set at price creation) still resolves the type.
 */
function resolveUnits(
  session: Stripe.Checkout.Session,
  types: RkTicketType[],
): ResolvedUnit[] {
  const items = session.line_items?.data ?? [];
  if (items.length === 0) {
    throw new Error("[ticket-fulfil] the session carries no line_items — cannot fulfil");
  }
  const byPriceId = new Map<string, RkTicketType>();
  const byTypeId = new Map<string, RkTicketType>(types.map((type) => [type.id, type]));
  for (const type of types) {
    if (type.stripe_price_id) byPriceId.set(type.stripe_price_id, type);
  }

  const units = new Map<string, ResolvedUnit>();
  for (const lineItem of items) {
    const priceId = priceIdOfLineItem(lineItem);
    const metadata = priceMetadataOfLineItem(lineItem);
    const type =
      (priceId ? byPriceId.get(priceId) : undefined) ??
      (metadata?.ticket_type_id ? byTypeId.get(metadata.ticket_type_id) : undefined);
    if (!type) {
      throw new Error(
        `[ticket-fulfil] line item price ${priceId ?? "(unknown)"} does not map to any ticket type of the order's concert`,
      );
    }
    const quantity = lineItem.quantity ?? 1;
    const existing = units.get(type.id);
    units.set(type.id, { type, quantity: (existing?.quantity ?? 0) + quantity });
  }
  return [...units.values()];
}

/** Buyer enrichment: only fields the purchase form left empty are filled. */
function buyerPatchFromSession(order: RkOrder, session: Stripe.Checkout.Session): Record<string, string> {
  const patch: Record<string, string> = {};
  const details = session.customer_details;
  if (!details) return patch;
  if (!order.buyer_name && details.name) patch.buyer_name = details.name;
  if (!order.buyer_email && details.email) patch.buyer_email = details.email;
  if (!order.buyer_phone && details.phone) patch.buyer_phone = details.phone;
  const address = details.address;
  if (address) {
    if (!order.address_street && address.line1) patch.address_street = address.line1;
    if (!order.address_city && address.city) patch.address_city = address.city;
    if (!order.address_postal && address.postal_code) patch.address_postal = address.postal_code;
  }
  return patch;
}

/**
 * The shared fulfilment core: applies the order patch (marking the order
 * `paid`), creates one ticket row per unit, increments `sold` per type,
 * flips the concert to `sold_out` when every active type is at capacity,
 * then sends the ticket e-mail and stamps `emailed_at`. Callers resolve the
 * units themselves — the Stripe path maps them off the session's line items,
 * the free path (card 11) already knows them from its validation.
 *
 * Card 12 — `pricing` (the Stripe path always passes it, the free path never
 * does): the order's `amount_huf` becomes the amount the buyer PAID (never
 * the list price), the discount is stored (`discount_huf` + `discount_code`),
 * and each ticket row carries its ALLOCATED gross price (the discount split
 * proportionally, remainder on the last ticket — `allocateDiscountGross`).
 * Our own `times_redeemed` counter of the used code is incremented once per
 * fulfilled order.
 */
async function writeFulfilment(
  order: RkOrder,
  units: ResolvedUnit[],
  orderPatch: Record<string, unknown>,
  pricing: SessionPricing | null,
): Promise<Extract<FulfilResult, { outcome: "fulfilled" }>> {
  const orderId = order.id;
  if (pricing) {
    orderPatch.amount_huf = pricing.paidHuf;
    orderPatch.discount_huf = pricing.discountHuf;
    orderPatch.discount_code = pricing.discountCode;
  }
  const { error: orderError } = await db().from("rk_orders").update(orderPatch).eq("id", orderId);
  if (orderError) throw new Error(`[ticket-fulfil] rk_orders update failed: ${orderError.message}`);

  // One ticket row per paid unit — this is the only place tickets are
  // created. Card 12: the price on the ticket is the ALLOCATED gross (the
  // money), not the list price — the invoice, the storno, the e-mail and the
  // success page all follow it.
  const listPrices: number[] = [];
  const ticketRows = [];
  for (const unit of units) {
    for (let i = 0; i < unit.quantity; i++) {
      listPrices.push(unit.type.price_huf);
    }
  }
  const grossPrices = pricing ? allocateDiscountGross(listPrices, pricing) : listPrices;
  let cursor = 0;
  for (const unit of units) {
    for (let i = 0; i < unit.quantity; i++) {
      ticketRows.push({
        order_id: orderId,
        concert_id: order.concert_id,
        ticket_type_id: unit.type.id,
        ticket_type_name: unit.type.name,
        price_huf: grossPrices[cursor],
        code: makeCode(),
        status: "valid",
      });
      cursor += 1;
    }
  }
  const { data: insertedTickets, error: ticketError } = await db()
    .from("rk_tickets")
    .insert(ticketRows)
    .select();
  if (ticketError || !insertedTickets) {
    throw new Error(`[ticket-fulfil] rk_tickets insert failed: ${ticketError?.message ?? "unknown error"}`);
  }
  const tickets = insertedTickets as RkTicket[];

  // Card 12: our own redemption counter — +1 per fulfilled order (the
  // already_fulfilled guard above makes this idempotent on webhook replays).
  if (pricing?.discountRowId) {
    try {
      await incrementDiscountTimesRedeemed(pricing.discountRowId);
    } catch (err) {
      console.error(`[ticket-fulfil] times_redeemed increment failed for code row ${pricing.discountRowId}:`, err);
    }
  }

  // Read-modify-write `sold` per type (blessed by the card at this volume).
  for (const unit of units) {
    const { error: soldError } = await db()
      .from("rk_ticket_types")
      .update({ sold: unit.type.sold + unit.quantity })
      .eq("id", unit.type.id);
    if (soldError) throw new Error(`[ticket-fulfil] rk_ticket_types sold update failed: ${soldError.message}`);
  }

  // Flip the concert to sold_out once every active type is at capacity.
  const typesAfter = await getTicketTypes(order.concert_id);
  const active = typesAfter.filter((type) => type.active);
  const soldOut =
    active.length > 0 && active.every((type) => type.capacity !== null && type.sold >= (type.capacity ?? 0));
  if (soldOut && order.concert_id) {
    await setConcertStatus(order.concert_id, "sold_out");
  }

  // Ticket e-mail: sent after the DB writes; failure never fails fulfilment.
  const concert = await getConcert(order.concert_id);
  const email = await sendTicketEmail({
    orderId,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email ?? "",
    concert: concert
      ? {
          title: concert.title,
          event_date: concert.event_date,
          event_time: concert.event_time,
          venue: concert.venue,
          location: concert.location,
        }
      : { title: "Réz körút koncert", event_date: null, event_time: null, venue: null, location: null },
    tickets: tickets.map((ticket) => ({
      code: ticket.code,
      ticket_type_name: ticket.ticket_type_name,
      price_huf: ticket.price_huf,
    })),
  });
  if (email.ok) {
    const { error: stampedError } = await db()
      .from("rk_tickets")
      .update({ emailed_at: nowIso() })
      .eq("order_id", orderId);
    if (stampedError) {
      console.error(`[ticket-fulfil] emailed_at stamp failed for order ${orderId}:`, stampedError.message);
    }
  } else {
    console.error(
      `[ticket-fulfil] ticket e-mail failed for order ${orderId} (emailed_at stays null; a resend route is a later card):`,
      email.error,
    );
  }

  return { outcome: "fulfilled", orderId, tickets, email, soldOut };
}

/**
 * Fulfils a paid Checkout Session: marks the order paid, creates one ticket
 * row per paid unit, increments `sold` per type, flips the concert to
 * `sold_out` when every active type is at capacity, then sends the ticket
 * e-mail and stamps `emailed_at`.
 */
export async function fulfilOrder(session: Stripe.Checkout.Session): Promise<FulfilResult> {
  const orderId = session.metadata?.order_id ?? session.client_reference_id ?? null;
  if (!orderId) {
    return { outcome: "skipped", orderId: null, reason: "the session carries no order reference" };
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return { outcome: "skipped", orderId, reason: "no rk_orders row for the session" };
  }

  const existingTickets = await listTicketsForOrder(orderId);
  if (order.status === "paid" && existingTickets.length > 0) {
    return { outcome: "already_fulfilled", orderId, ticketCount: existingTickets.length };
  }
  if (order.status === "refunded") {
    return { outcome: "skipped", orderId, reason: "the order is already refunded — nothing to fulfil" };
  }

  const types = await getTicketTypes(order.concert_id);
  const units = resolveUnits(session, types);

  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const buyerPatch = buyerPatchFromSession(order, session);
  const orderPatch: Record<string, unknown> = {
    status: "paid",
    paid_at: nowIso(),
    ...buyerPatch,
  };
  if (paymentIntent && !order.stripe_payment_intent) {
    orderPatch.stripe_payment_intent = paymentIntent;
  }
  // Card 12: the money the buyer actually paid — `amount_huf` becomes the
  // finalized total, the discount is attributed (code + amount), and the
  // tickets carry their allocated gross prices.
  const pricing = await resolveSessionDiscount(session);
  return writeFulfilment(order, units, orderPatch, pricing);
}

/**
 * Fulfils a free (0 Ft) order (card 11): same shared core as a paid session —
 * mark paid, create one ticket per requested unit, increment `sold`, flip the
 * concert to `sold_out` at capacity, send the ticket e-mail. The order row is
 * inserted by `POST /api/tickets/free` as `pending` with the `FREE` marker;
 * this flips it to `paid` exactly like the webhook flips a paid order, and is
 * idempotent the same way.
 */
export async function fulfilFreeOrder(orderId: string, units: ResolvedUnit[]): Promise<FulfilResult> {
  const order = await getOrderById(orderId);
  if (!order) {
    return { outcome: "skipped", orderId, reason: "no rk_orders row for the free request" };
  }

  const existingTickets = await listTicketsForOrder(orderId);
  if (order.status === "paid" && existingTickets.length > 0) {
    return { outcome: "already_fulfilled", orderId, ticketCount: existingTickets.length };
  }
  if (order.status === "refunded") {
    return { outcome: "skipped", orderId, reason: "the order is already refunded — nothing to fulfil" };
  }
  if (units.length === 0) {
    return { outcome: "skipped", orderId, reason: "the free request carries no units" };
  }

  // Free orders carry no money and no discount — no pricing patch.
  return writeFulfilment(order, units, { status: "paid", paid_at: nowIso() }, null);
}

/**
 * Manual "re-fetch session" path: retrieves the session with its line items
 * and its discounts expanded (webhook payloads may omit either; the expanded
 * promotion code carries the buyer-facing code string even for a promotion
 * code that is not ours) and fulfils it.
 * Idempotent through `fulfilOrder`.
 */
export async function fetchSessionAndFulfil(stripe: Stripe, sessionId: string): Promise<FulfilResult> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "discounts.promotion_code"],
  });
  return fulfilOrder(session);
}

// ---------------------------------------------------------------------------
// Refund (shared DB updates for the webhook branch and the intern route)
// ---------------------------------------------------------------------------

/**
 * Marks an order `refunded` and voids all its tickets. Used by the
 * `charge.refunded` webhook branch and by the intern refund route after
 * `stripe.refunds.create` succeeds. Idempotent: re-applying is harmless.
 */
export async function markOrderRefunded(match: {
  orderId?: string;
  paymentIntent?: string;
}): Promise<{ order: RkOrder; voided: number } | null> {
  const order = match.orderId
    ? await getOrderById(match.orderId)
    : match.paymentIntent
      ? await getOrderByPaymentIntent(match.paymentIntent)
      : null;
  if (!order) return null;

  const { data: updated, error: orderError } = await db()
    .from("rk_orders")
    .update({ status: "refunded", refunded_at: nowIso() })
    .eq("id", order.id)
    .select()
    .single();
  if (orderError || !updated) {
    throw new Error(`[ticket-fulfil] rk_orders refund update failed: ${orderError?.message ?? "unknown"}`);
  }

  const { data: voided, error: ticketError } = await db()
    .from("rk_tickets")
    .update({ status: "void" })
    .eq("order_id", order.id)
    .select("id");
  if (ticketError) throw new Error(`[ticket-fulfil] rk_tickets void failed: ${ticketError.message}`);

  return { order: updated as RkOrder, voided: (voided ?? []).length };
}

export type RefundResult =
  | { outcome: "refunded"; refundId: string; order: RkOrder; voided: number }
  | { outcome: "already_refunded"; order: RkOrder; voided: number; note: string }
  | { outcome: "not_paid"; status: string }
  | { outcome: "no_payment_intent" }
  | { outcome: "unknown_order" };

/**
 * The intern refund route's body: a FULL refund of a paid order, issued by
 * the owner when a concert is cancelled or materially moved (the reason is
 * the operator's declaration — buyers never self-refund, their tickets are
 * transferable instead). Idempotent: an already-refunded order returns a note
 * without touching Stripe.
 */
export async function refundPaidOrder(
  stripe: Stripe,
  orderId: string,
  reason: "cancelled" | "moved",
): Promise<RefundResult> {
  const order = await getOrderById(orderId);
  if (!order) return { outcome: "unknown_order" };

  if (order.status === "refunded") {
    const mark = await markOrderRefunded({ orderId });
    return {
      outcome: "already_refunded",
      order: mark?.order ?? order,
      voided: mark?.voided ?? 0,
      note: "A rendelés már visszatérítésre került.",
    };
  }
  if (order.status !== "paid") {
    return { outcome: "not_paid", status: order.status };
  }
  if (order.stripe_payment_intent === FREE_ORDER_MARKER) {
    // Free order (card 11): no money ever moved, so there is nothing to
    // refund at Stripe — the refund is DB-only: mark refunded + void the
    // tickets, exactly what a cancelled concert should do to complimentary
    // tickets too.
    const mark = await markOrderRefunded({ orderId });
    if (!mark) return { outcome: "unknown_order" };
    return { outcome: "refunded", refundId: "", order: mark.order, voided: mark.voided };
  }
  if (!order.stripe_payment_intent) {
    return { outcome: "no_payment_intent" };
  }

  console.log(`[ticket-fulfil] refunding order ${orderId} (reason: ${reason})`);
  const refund = await stripe.refunds.create({
    payment_intent: order.stripe_payment_intent,
    reason: "requested_by_customer",
  });

  const mark = await markOrderRefunded({ orderId });
  if (!mark) return { outcome: "unknown_order" };
  return { outcome: "refunded", refundId: refund.id, order: mark.order, voided: mark.voided };
}
