import { NextResponse, type NextRequest } from "next/server";

import { setDiscountCodeActiveWithStripe } from "@/lib/discount-codes";
import { getStripeClient } from "@/lib/stripe-tickets";
import { getDiscountCodeById, getTicketDb } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/intern/kedvezmenykodok/[id] `{active: boolean}` (card 12) — the
 * panel's on/off switch. Deactivating sets the Stripe promotion code
 * inactive and the row inactive (never a delete); reactivating works the same
 * way. Codes are immutable otherwise: changing the coupon of an existing
 * code is not allowed — the UI says so, and this route simply has no
 * parameter for it.
 */

type RouteContext = { params: Promise<{ id: string }> };

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }
  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { error: "A Stripe nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }
  const active = (body as { active?: unknown } | null)?.active;
  if (typeof active !== "boolean") {
    return NextResponse.json({ error: "Az állapot (aktív/inaktív) megadása kötelező." }, { status: 400 });
  }

  try {
    const row = await getDiscountCodeById(id);
    if (!row) {
      return NextResponse.json({ error: "Nincs ilyen kedvezménykód." }, { status: 404 });
    }
    const updated = await setDiscountCodeActiveWithStripe(stripe, row, active);
    return NextResponse.json({ code: updated });
  } catch (err) {
    console.error("[api/intern/kedvezmenykodok/[id]] PATCH failed:", err);
    return NextResponse.json(
      { error: "Nem sikerült módosítani a kedvezménykódot. Kérem, próbálja újra." },
      { status: 500 },
    );
  }
}
