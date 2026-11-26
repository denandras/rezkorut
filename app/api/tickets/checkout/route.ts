import { NextResponse, type NextRequest } from "next/server";

import { getStripeClient } from "@/lib/stripe-tickets";
import {
  CheckoutError,
  createOrderAndCheckoutSession,
  parseCheckoutRequest,
} from "@/lib/ticket-checkout";
import { getTicketDb } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public checkout entry point (no intern cookie): POST /api/tickets/checkout
 * `{concert_id, items:[{ticket_type_id, quantity}], buyer:{name,email,phone,
 * address{postal_code,city,street}}, accept_terms:true}` → `{url}` — the
 * hosted Stripe Checkout URL.
 *
 * Every client-rejectable condition is checked here and in the shared
 * checkout lib against the live DB; the amount is recomputed server-side
 * from rk_ticket_types (client prices are never read).
 */

export async function POST(req: NextRequest) {
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Hibás kérés." }, { status: 400 });
  }

  // Terms gate first — nothing else is even parsed into a session without it.
  const acceptTerms = (body as { accept_terms?: unknown } | null)?.accept_terms;
  if (acceptTerms !== true) {
    return NextResponse.json(
      { error: "terms_required", message: "A vásárlási feltételek elfogadása kötelező." },
      { status: 400 },
    );
  }

  const parsed = parseCheckoutRequest(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: "bad_request", message: parsed.error }, { status: 400 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { error: "A Stripe nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  try {
    const result = await createOrderAndCheckoutSession(stripe, parsed.request, req.nextUrl.origin);
    if (!result.url) {
      throw new CheckoutError(500, "no_url", "A Stripe nem adott fizetési URL-t.");
    }
    return NextResponse.json({ url: result.url });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          ...(err.ticketType ? { ticket_type: err.ticketType } : {}),
        },
        { status: err.status },
      );
    }
    console.error("[api/tickets/checkout] POST failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: "Nem sikerült elindítani a fizetést." },
      { status: 500 },
    );
  }
}
