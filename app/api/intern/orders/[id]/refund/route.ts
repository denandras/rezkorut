import { NextResponse, type NextRequest } from "next/server";

import { getStripeClient } from "@/lib/stripe-tickets";
import { refundPaidOrder } from "@/lib/ticket-fulfil";
import { getTicketDb } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Owner-issued full refund (intern cookie required):
 * POST /api/intern/orders/[id]/refund `{reason:"cancelled"|"moved"}`.
 *
 * There is no buyer-requested refund — the ticket is transferable instead;
 * a refund happens only when the concert is cancelled or materially moved,
 * and the owner declares that through `reason`. The Stripe refund is created
 * with `reason:"requested_by_customer"` (the API's fixed vocabulary), then the
 * same DB updates as the `charge.refunded` webhook branch run. Idempotent:
 * an already-refunded order answers 200 with a note, without touching Stripe.
 */

type RouteContext = { params: Promise<{ id: string }> };

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  let body: { reason?: unknown };
  try {
    body = (await req.json()) as { reason?: unknown };
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }
  if (body.reason !== "cancelled" && body.reason !== "moved") {
    return NextResponse.json(
      { error: "Az ok csak „cancelled” (elmaradt) vagy „moved” (áthelyezett) lehet." },
      { status: 400 },
    );
  }
  const reason = body.reason;

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { error: "A Stripe nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  const { id } = await ctx.params;

  try {
    const result = await refundPaidOrder(stripe, id, reason);
    switch (result.outcome) {
      case "refunded":
        return NextResponse.json({
          ok: true,
          // A free order (card 11) refunds DB-only — no Stripe refund exists,
          // so instead of an empty id the response says what happened.
          ...(result.refundId
            ? { refund_id: result.refundId }
            : { note: "Ingyenes rendelés – a jegyek visszaváltva, pénzmozgás nem történt." }),
          order: result.order,
          tickets_void: result.voided,
        });
      case "already_refunded":
        return NextResponse.json({
          ok: true,
          note: result.note,
          order: result.order,
          tickets_void: result.voided,
        });
      case "not_paid":
        return NextResponse.json(
          { error: "Csak már kifizetett rendelés téríthető vissza." },
          { status: 400 },
        );
      case "no_payment_intent":
        return NextResponse.json(
          { error: "A rendeléshez nem tartozik fizetési szándék, nem téríthető vissza." },
          { status: 500 },
        );
      case "unknown_order":
      default:
        return NextResponse.json({ error: "Nincs ilyen rendelés." }, { status: 404 });
    }
  } catch (err) {
    console.error("[api/intern/orders/refund] POST failed:", err);
    return NextResponse.json(
      { error: "Nem sikerült a visszatérítés." },
      { status: 502 },
    );
  }
}
