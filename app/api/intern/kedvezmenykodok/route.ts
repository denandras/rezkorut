import { NextResponse, type NextRequest } from "next/server";

import { createDiscountCode, parseDiscountCodeCreate } from "@/lib/discount-codes";
import { getStripeClient } from "@/lib/stripe-tickets";
import { getTicketDb, listConcertsWithSales, listDiscountCodes } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/intern/kedvezmenykodok (card 12) — the kedvezménykód list + create of
 * the dashboard's „Kedvezménykódok" panel and its global list page.
 *
 *  - GET → `{codes:[...]}`: every row (newest first), each with the concert's
 *    title when the code is scoped to a concert (null = minden koncertre).
 *  - POST → create: Stripe coupon + promotion code, then the DB row. The
 *    validation is lib/discount-codes'; every refusal answers with the
 *    Hungarian message the panel shows inline.
 *
 * Intern-cookie-gated like every /api/intern route; Stripe writes are
 * server-side only.
 */

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

export async function GET(req: NextRequest) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }
  try {
    const [codes, concerts] = await Promise.all([listDiscountCodes(), listConcertsWithSales()]);
    const titleById = new Map(concerts.map((entry) => [entry.concert.concert_id, entry.concert.title]));
    return NextResponse.json({
      codes: codes.map((code) => ({
        ...code,
        concert_title: code.concert_id ? titleById.get(code.concert_id) ?? null : null,
      })),
    });
  } catch (err) {
    console.error("[api/intern/kedvezmenykodok] GET failed:", err);
    return NextResponse.json({ error: "Nem sikerült betölteni a kedvezménykódokat." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }

  const parsed = await parseDiscountCodeCreate(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await createDiscountCode(stripe, parsed.input);
    console.log(
      `[api/intern/kedvezmenykodok] created code ${result.row.code} ` +
        `(coupon ${result.stripeCouponId}, promotion code ${result.stripePromotionCodeId})`,
    );
    return NextResponse.json({
      code: result.row,
      stripe_coupon_id: result.stripeCouponId,
      stripe_promotion_code_id: result.stripePromotionCodeId,
    });
  } catch (err) {
    console.error("[api/intern/kedvezmenykodok] POST failed:", err);
    return NextResponse.json(
      { error: "Nem sikerült létrehozni a kedvezménykódot. Kérem, próbálja újra." },
      { status: 500 },
    );
  }
}
