import { NextResponse, type NextRequest } from "next/server";
import {
  getConcert,
  getTicketDb,
  getTicketTypes,
  setConcertStatus,
  todayIsoInBudapest,
} from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Publishes a concert: status → `on_sale`. Requires at least one active ticket
 * type, a not-yet-past event date, and at least one active type with a Stripe
 * price id.
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

  const { id } = await ctx.params;

  try {
    const concert = await getConcert(id);
    if (!concert) {
      return NextResponse.json({ error: "Nincs ilyen koncert." }, { status: 404 });
    }

    const types = await getTicketTypes(id);
    const activeTypes = types.filter((type) => type.active);
    if (activeTypes.length === 0) {
      return NextResponse.json(
        { error: "Legalább egy aktív jegytípus szükséges a publikáláshoz." },
        { status: 400 },
      );
    }

    const today = todayIsoInBudapest();
    if (!concert.event_date || concert.event_date < today) {
      return NextResponse.json(
        { error: "A koncert dátuma már elmúlt, nem publikálható." },
        { status: 400 },
      );
    }

    if (!activeTypes.some((type) => type.stripe_price_id)) {
      return NextResponse.json(
        { error: "Nincs Stripe ár rendelve az aktív jegytípusokhoz." },
        { status: 400 },
      );
    }

    const updated = await setConcertStatus(id, "on_sale");
    if (!updated) {
      return NextResponse.json({ error: "Nem sikerült publikálni a koncertet." }, { status: 500 });
    }
    return NextResponse.json({ concert: updated });
  } catch (err) {
    console.error("[api/intern/koncertek/publish] POST failed:", err);
    return NextResponse.json({ error: "Nem sikerült publikálni a koncertet." }, { status: 500 });
  }
}
