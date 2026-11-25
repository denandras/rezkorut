import type Stripe from "stripe";

import { makeCode } from "@/lib/ticket-code";
import {
  getConcert,
  getTicketDb,
  getTicketTypes,
  listTicketsForOrder,
  setConcertStatus,
  type RkOrder,
  type RkTicket,
  type RkTicketType,
} from "@/lib/ticket-db";
import { sendTicketEmail, type TicketEmailResult } from "@/lib/ticket-email";

/**
 * Shared fulfilment + refund logic (card 03). This module is the ONLY place
 * that creates `rk_tickets` rows: the Stripe webhook uses it, and any future
 * caller (a manual "re-fetch session" retry path, a resend route) shares it.
 *
 * `fulfilOrder` is idempotent: a paid order that already has tickets is left
 * untouched (webhook replays are a normal Stripe occurrence). The e-mail is
 * sent after the DB writes and its failure never fails the caller —
 * `emailed_at` simply stays null (the resend retry route is a later card).
 *
 * Node type-stripping compatibility: no parameter properties, no enums
 * (the verification harness imports this file directly).
 */

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
// Fulfilment
// ---------------------------------------------------------------------------

export type FulfilResult =
  | { outcome: "fulfilled"; orderId: string; tickets: RkTicket[]; email: TicketEmailResult; soldOut: boolean }
  | { outcome: "already_fulfilled"; orderId: string; ticketCount: number }
  | { outcome: "skipped"; orderId: string | null; reason: string };

type ResolvedUnit = { type: RkTicketType; quantity: number };

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
  const { error: orderError } = await db().from("rk_orders").update(orderPatch).eq("id", orderId);
  if (orderError) throw new Error(`[ticket-fulfil] rk_orders update failed: ${orderError.message}`);

  // One ticket row per paid unit — this is the only place tickets are created.
  const ticketRows = [];
  for (const unit of units) {
    for (let i = 0; i < unit.quantity; i++) {
      ticketRows.push({
        order_id: orderId,
        concert_id: order.concert_id,
        ticket_type_id: unit.type.id,
        ticket_type_name: unit.type.name,
        price_huf: unit.type.price_huf,
        code: makeCode(),
        status: "valid",
      });
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
 * Manual "re-fetch session" path: retrieves the session with its line items
 * expanded (webhook payloads never include line_items) and fulfils it.
 * Idempotent through `fulfilOrder`.
 */
export async function fetchSessionAndFulfil(stripe: Stripe, sessionId: string): Promise<FulfilResult> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
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
