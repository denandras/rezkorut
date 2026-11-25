import { getTicketDb, type TicketKind } from "@/lib/ticket-db";
import { isValidCode } from "@/lib/ticket-code";
import type { Concert } from "@/lib/upcoming-concerts";

/**
 * PUBLIC, server-side reads of the ticketing tables (card 05).
 *
 * Everything here runs on the server only (the Supabase client is the
 * service-role one from lib/ticket-db, which bypasses RLS) and returns ONLY
 * buyer-safe projections: concert facts and ticket-type facts. Buyer and order
 * data is never part of the projection — the only exception is the success
 * page lookup, which is keyed on the buyer's own Stripe session id and
 * exposes nothing beyond the buyer's own name.
 *
 * Never import this module from a client component. A client component may
 * import the *types* with `import type` only (erased at compile time).
 */

// ---------------------------------------------------------------------------
// Public shapes (strict projections — add a field only after asking what a
// random visitor could learn from it)
// ---------------------------------------------------------------------------

export type PublicTicketType = {
  id: string;
  name: string;
  kind: TicketKind;
  /** Gross price exactly as stored (AAM seller). */
  price_huf: number;
  /** Capacity minus sold; null when the type has no capacity cap. */
  remaining: number | null;
};

export type PublicConcertTicketing = {
  concert_id: string;
  title: string;
  /** Event date, sortable ISO (`2026-11-27`). */
  date: string | null;
  /** Event time as stored (`19:00`). */
  time: string | null;
  venue: string | null;
  location: string | null;
  /** True only while the owner has the concert `on_sale`. */
  on_sale: boolean;
  /** Active ticket types inside their sales window, in `sort` order. */
  types: PublicTicketType[];
};

/**
 * The public buy page's data: one `rk_concerts` row plus its active ticket
 * types. Returns null when the ticketing DB is not configured or the concert
 * has no row (never an error page — the caller renders a plain sentence).
 */
export async function getPublicConcertTicketing(
  concertId: string,
): Promise<PublicConcertTicketing | null> {
  const db = getTicketDb();
  if (!db) return null;

  const [concertRes, typesRes] = await Promise.all([
    db
      .from("rk_concerts")
      .select("concert_id,title,event_date,event_time,venue,location,status")
      .eq("concert_id", concertId)
      .maybeSingle(),
    db
      .from("rk_ticket_types")
      .select("id,name,kind,price_huf,capacity,sold,active,sales_start,sales_end")
      .eq("concert_id", concertId)
      .order("sort")
      .order("created_at"),
  ]);
  if (concertRes.error || typesRes.error) {
    console.error(
      "[tickets-public] public concert read failed:",
      concertRes.error?.message ?? typesRes.error?.message,
    );
    return null;
  }
  const concert = concertRes.data as
    | {
        concert_id: string;
        title: string;
        event_date: string | null;
        event_time: string | null;
        venue: string | null;
        location: string | null;
        status: string;
      }
    | null;
  if (!concert) return null;

  const now = Date.now();
  const types = ((typesRes.data ?? []) as {
    id: string;
    name: string;
    kind: TicketKind;
    price_huf: number;
    capacity: number | null;
    sold: number;
    active: boolean;
    sales_start: string | null;
    sales_end: string | null;
  }[])
    .filter(
      (type) =>
        type.active &&
        (!type.sales_start || now >= Date.parse(type.sales_start)) &&
        (!type.sales_end || now <= Date.parse(type.sales_end)),
    )
    .map((type) => ({
      id: type.id,
      name: type.name,
      kind: type.kind,
      price_huf: type.price_huf,
      remaining:
        type.capacity === null ? null : Math.max(0, type.capacity - type.sold),
    }));

  return {
    concert_id: concert.concert_id,
    title: concert.title,
    date: concert.event_date,
    time: concert.event_time,
    venue: concert.venue,
    location: concert.location,
    on_sale: concert.status === "on_sale",
    types,
  };
}

// ---------------------------------------------------------------------------
// Concert-card CTA annotation (/esemenyek + landing)
// ---------------------------------------------------------------------------

/**
 * Returns copies of `concerts` with `ticketUrl` set (`/jegyek/<id>`) for every
 * concert that is currently `on_sale` in the ticketing DB. Concerts without a
 * stable id, or without an on-sale row, come back unchanged. Fails closed: on
 * a DB error the input is returned untouched (the events page never breaks
 * because ticketing is down — the CTA simply does not show).
 */
export async function withTicketUrls(concerts: Concert[]): Promise<Concert[]> {
  const db = getTicketDb();
  const ids = concerts.flatMap((concert) => (concert.id ? [concert.id] : []));
  if (!db || ids.length === 0) return concerts;

  const { data, error } = await db
    .from("rk_concerts")
    .select("concert_id,status")
    .in("concert_id", ids);
  if (error) {
    console.error("[tickets-public] on-sale lookup failed:", error.message);
    return concerts;
  }
  const onSale = new Set(
    ((data ?? []) as { concert_id: string; status: string }[])
      .filter((row) => row.status === "on_sale")
      .map((row) => row.concert_id),
  );

  return concerts.map((concert) =>
    concert.id && onSale.has(concert.id)
      ? { ...concert, ticketUrl: `/jegyek/${concert.id}` }
      : concert,
  );
}

// ---------------------------------------------------------------------------
// Success page lookup (keyed on the buyer's own Stripe session id)
// ---------------------------------------------------------------------------

export type PublicPaidOrder = {
  order: {
    id: string;
    status: string;
    /** The buyer's own name — the only buyer datum the success page shows. */
    buyer_name: string | null;
    amount_huf: number;
  };
  tickets: {
    code: string;
    type: string | null;
    price_huf: number;
    status: string;
  }[];
};

/**
 * The success page's data: an order by its Stripe session id (the buyer's own
 * checkout URL carries this id — it is the only accepted lookup key) with the
 * ticket rows created by the webhook. Null when no order matches.
 */
export async function getOrderBySessionId(
  sessionId: string,
): Promise<PublicPaidOrder | null> {
  return getOrderForSuccessBy("stripe_session_id", sessionId);
}

/**
 * The success page's data for a free (0 Ft) order (card 11): the lookup key
 * is the order id, but the page may only call this with an id it obtained
 * from a VERIFIED signed confirmation token (lib/order-token) — never a bare
 * id out of a URL. Same projection as the session-id path.
 */
export async function getOrderByIdForSuccess(orderId: string): Promise<PublicPaidOrder | null> {
  return getOrderForSuccessBy("id", orderId);
}

async function getOrderForSuccessBy(
  column: "stripe_session_id" | "id",
  value: string,
): Promise<PublicPaidOrder | null> {
  const db = getTicketDb();
  if (!db || value.trim().length === 0) return null;

  const { data: order, error } = await db
    .from("rk_orders")
    .select("id,status,buyer_name,amount_huf")
    .eq(column, value.trim())
    .maybeSingle();
  if (error) {
    console.error(`[tickets-public] order-by-${column === "id" ? "id" : "session"} read failed:`, error.message);
    return null;
  }
  if (!order) return null;

  const { data: tickets, error: ticketsError } = await db
    .from("rk_tickets")
    .select("code,ticket_type_name,price_huf,status")
    .eq("order_id", (order as { id: string }).id)
    .order("created_at");
  if (ticketsError) {
    console.error("[tickets-public] tickets-for-order read failed:", ticketsError.message);
    return null;
  }

  return {
    order: {
      id: (order as { id: string }).id,
      status: (order as { status: string }).status,
      buyer_name: (order as { buyer_name: string | null }).buyer_name,
      amount_huf: (order as { amount_huf: number }).amount_huf,
    },
    tickets: ((tickets ?? []) as {
      code: string;
      ticket_type_name: string | null;
      price_huf: number;
      status: string;
    }[]).map((ticket) => ({
      code: ticket.code,
      type: ticket.ticket_type_name,
      price_huf: ticket.price_huf,
      status: ticket.status,
    })),
  };
}


// ---------------------------------------------------------------------------
// Ticket landing page (/j/<code> — the QR target, card 08)
// ---------------------------------------------------------------------------

export type PublicTicketByCode = {
  /** Public facts of the concert — `concert_id` is public (the buy URL carries it). */
  concert: {
    concert_id: string;
    title: string;
    /** Event date, sortable ISO (`2026-11-27`). */
    date: string | null;
    /** Event time as stored (`19:00`). */
    time: string | null;
    venue: string | null;
    location: string | null;
    status: string;
  } | null;
  ticket: {
    code: string;
    type: string | null;
    status: "valid" | "used" | "void";
    used_at: string | null;
  };
};

/**
 * The /j/<code> page's data: one ticket by its code plus its concert's public
 * facts. Deliberately minimal — no buyer name, e-mail or address is ever
 * selected, so a random visitor (or a leaked link) learns nothing about the
 * buyer. The code is normalized exactly like the door panel normalizes it
 * (trim, uppercase, strip spaces and dashes). Null when the DB is not
 * configured, the code is not shaped like a ticket code, or no ticket
 * matches — the page renders the same calm "no ticket" state for all three.
 */
export async function getTicketByCode(code: string): Promise<PublicTicketByCode | null> {
  const db = getTicketDb();
  const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!db || !isValidCode(normalized)) return null;

  const { data: ticket, error } = await db
    .from("rk_tickets")
    .select("code,ticket_type_name,status,used_at,concert_id")
    .eq("code", normalized)
    .maybeSingle();
  if (error) {
    console.error("[tickets-public] ticket-by-code read failed:", error.message);
    return null;
  }
  if (!ticket) return null;

  const { data: concert, error: concertError } = await db
    .from("rk_concerts")
    .select("concert_id,title,event_date,event_time,venue,location,status")
    .eq("concert_id", (ticket as { concert_id: string }).concert_id)
    .maybeSingle();
  if (concertError) {
    console.error("[tickets-public] concert-for-ticket read failed:", concertError.message);
    return null;
  }

  const row = ticket as {
    code: string;
    ticket_type_name: string | null;
    status: "valid" | "used" | "void";
    used_at: string | null;
  };

  const concertRow = (concert as {
    concert_id: string;
    title: string;
    event_date: string | null;
    event_time: string | null;
    venue: string | null;
    location: string | null;
    status: string;
  } | null) ?? null;

  return {
    concert: concertRow
      ? {
          concert_id: concertRow.concert_id,
          title: concertRow.title,
          date: concertRow.event_date,
          time: concertRow.event_time,
          venue: concertRow.venue,
          location: concertRow.location,
          status: concertRow.status,
        }
      : null,
    ticket: {
      code: row.code,
      type: row.ticket_type_name,
      status: row.status,
      used_at: row.used_at,
    },
  };
}
