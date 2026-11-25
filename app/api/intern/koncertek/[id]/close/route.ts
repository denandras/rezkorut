import { NextResponse, type NextRequest } from "next/server";
import { getConcert, getTicketDb, setConcertStatus } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Closes a concert: status → `closed`. Sales stop; rows are never deleted. */

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

    const updated = await setConcertStatus(id, "closed");
    if (!updated) {
      return NextResponse.json({ error: "Nem sikerült lezárni a koncertet." }, { status: 500 });
    }
    return NextResponse.json({ concert: updated });
  } catch (err) {
    console.error("[api/intern/koncertek/close] POST failed:", err);
    return NextResponse.json({ error: "Nem sikerült lezárni a koncertet." }, { status: 500 });
  }
}
