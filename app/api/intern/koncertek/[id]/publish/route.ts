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
 * type and a not-yet-past event date. Card 11: a 0 Ft type is an ingyenes
 * jegy — it never blocks publishing (a concert with only free types may go
 * on sale), and it never needs a Stripe price. The paid rules apply only
 * when there is a paid type at all: at least one paid type ≥ 200 Ft, and
 * every active paid type must carry its Stripe price id.
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

    // Card 11: paid rules apply only if there is a paid type at all — a
    // free-only concert may go on sale, a free type never blocks.
    const activePaid = activeTypes.filter((type) => type.price_huf > 0);
    if (activePaid.length > 0) {
      if (!activePaid.some((type) => type.price_huf >= 200)) {
        return NextResponse.json(
          { error: "A fizetős jegy ára legalább 200 forint." },
          { status: 400 },
        );
      }
      if (!activePaid.every((type) => type.stripe_price_id)) {
        return NextResponse.json(
          { error: "Nincs Stripe ár rendelve az aktív fizetős jegytípusokhoz." },
          { status: 400 },
        );
      }
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
