import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { getStripeClient } from "@/lib/stripe-tickets";
import { fetchSessionAndFulfil, fulfilOrder, markOrderRefunded } from "@/lib/ticket-fulfil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe webhook for ticket fulfilment (public, signature-verified with
 * STRIPE_TICKET_WEBHOOK_SECRET — the raw body is read before any parsing).
 *
 *  - `checkout.session.completed` (only `payment_status === "paid"`) and
 *    `checkout.session.async_payment_succeeded` → fulfilOrder(session).
 *    Webhook payloads never include `line_items`, so the session is re-fetched
 *    with them expanded before fulfilment — unless the payload already
 *    carries them (verification harness).
 *  - `charge.refunded` → the order is matched by `stripe_payment_intent`,
 *    marked refunded and all its tickets voided.
 *
 * Answers 200 as soon as the DB write is done. An e-mail failure never fails
 * the webhook (emailed_at stays null for a later retry — a resend route is a
 * later card). A handling failure answers 500 so Stripe retries.
 */

function hasLineItems(session: Stripe.Checkout.Session): boolean {
  return (session.line_items?.data?.length ?? 0) > 0;
}

function paymentIntentOf(object: unknown): string | null {
  const value = object as { payment_intent?: unknown } | null;
  const pi = value?.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && "id" in pi) {
    const id = (pi as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_TICKET_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    console.error("[api/tickets/webhook/stripe] Stripe or STRIPE_TICKET_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[api/tickets/webhook/stripe] signature verification failed:", err);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid") {
          console.log(`[api/tickets/webhook/stripe] session ${session.id} completed but payment_status=${session.payment_status} — ignored`);
          return NextResponse.json({ received: true, ignored: "payment_status_not_paid" });
        }
        const result = hasLineItems(session)
          ? await fulfilOrder(session)
          : await fetchSessionAndFulfil(stripe, session.id);
        return NextResponse.json({ received: true, fulfil: describeFulfil(result) });
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const result = hasLineItems(session)
          ? await fulfilOrder(session)
          : await fetchSessionAndFulfil(stripe, session.id);
        return NextResponse.json({ received: true, fulfil: describeFulfil(result) });
      }
      case "charge.refunded": {
        const paymentIntent = paymentIntentOf(event.data.object);
        if (!paymentIntent) {
          console.error("[api/tickets/webhook/stripe] charge.refunded without payment_intent — ignored");
          break;
        }
        const marked = await markOrderRefunded({ paymentIntent });
        if (!marked) {
          console.log(
            `[api/tickets/webhook/stripe] charge.refunded for ${paymentIntent}: no matching order — ignored`,
          );
          return NextResponse.json({ received: true, refund: null });
        }
        console.log(
          `[api/tickets/webhook/stripe] charge.refunded: order ${marked.order.id} refunded, ${marked.voided} ticket(s) voided`,
        );
        return NextResponse.json({
          received: true,
          refund: { order_id: marked.order.id, voided: marked.voided },
        });
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[api/tickets/webhook/stripe] handling ${event.type} failed:`, err);
    return NextResponse.json({ received: true, error: "handling_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Small describe of the fulfilment for the webhook response — operational
 * visibility (and the verification harness prints it; the only personal data
 * it carries is the recipient the e-mail itself went to).
 */
function describeFulfil(result: Awaited<ReturnType<typeof fulfilOrder>>): Record<string, unknown> {
  if (result.outcome === "fulfilled") {
    return {
      outcome: result.outcome,
      order_id: result.orderId,
      ticket_count: result.tickets.length,
      sold_out: result.soldOut,
      email: {
        ok: result.email.ok,
        skipped: result.email.skipped ?? false,
        accepted: result.email.accepted ?? [],
        rejected: result.email.rejected ?? [],
        messageId: result.email.messageId ?? null,
        error: result.email.error ?? null,
      },
    };
  }
  if (result.outcome === "already_fulfilled") {
    return { outcome: result.outcome, order_id: result.orderId, ticket_count: result.ticketCount };
  }
  return { outcome: result.outcome, order_id: result.orderId ?? null, reason: result.reason };
}
