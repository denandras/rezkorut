import { NextResponse, type NextRequest } from "next/server";
import { getConcert, getTicketDb, listOrders, listTicketsForOrder, type RkOrder, type RkTicket } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Orders of a concert, newest first, each with its tickets. */

type RouteContext = { params: Promise<{ id: string }> };

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

export type OrderWithTickets = RkOrder & { tickets: RkTicket[] };

export async function GET(req: NextRequest, ctx: RouteContext) {
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

    const orders = await listOrders(id);
    const withTickets: OrderWithTickets[] = await Promise.all(
      orders.map(async (order) => ({
        ...order,
        tickets: await listTicketsForOrder(order.id),
      })),
    );

    return NextResponse.json({ orders: withTickets });
  } catch (err) {
    console.error("[api/intern/koncertek/orders] GET failed:", err);
    return NextResponse.json({ error: "Nem sikerült betölteni a rendeléseket." }, { status: 500 });
  }
}
