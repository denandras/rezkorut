import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only ticketing data layer for the rk_* tables (see
 * supabase/migrations/20261125_rk_ticketing.sql — RLS on, no policies).
 *
 * NEVER import this module from a client component: the client is created
 * with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS on every table.
 *
 * `sold` per ticket type is incremented Postgres-side by the purchase
 * pipeline (card 03); this layer only reads it.
 */

// ---------------------------------------------------------------------------
// Row types (mirror supabase/migrations/20261125_rk_ticketing.sql)
// ---------------------------------------------------------------------------

export type ConcertStatus = "draft" | "on_sale" | "sold_out" | "closed";
export type TicketKind = "standard" | "early_bird";
export type OrderStatus = "pending" | "paid" | "refunded" | "expired" | "failed";
export type TicketStatus = "valid" | "used" | "void";

export type RkConcert = {
  concert_id: string;
  title: string;
  event_date: string | null;
  event_time: string | null;
  location: string | null;
  venue: string | null;
  status: ConcertStatus;
  created_at: string;
  updated_at: string;
};

export type RkTicketType = {
  id: string;
  concert_id: string;
  name: string;
  kind: TicketKind;
  price_huf: number;
  capacity: number | null;
  sold: number;
  stripe_price_id: string | null;
  stripe_lookup_key: string | null;
  sales_start: string | null;
  sales_end: string | null;
  active: boolean;
  sort: number;
  created_at: string;
};

export type RkOrder = {
  id: string;
  concert_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_company: string | null;
  buyer_tax_number: string | null;
  address_country: string | null;
  address_postal: string | null;
  address_city: string | null;
  address_street: string | null;
  amount_huf: number;
  currency: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  status: OrderStatus;
  paid_at: string | null;
  refunded_at: string | null;
  tacito_error: string | null;
  created_at: string;
};

export type RkTicket = {
  id: string;
  order_id: string;
  concert_id: string;
  ticket_type_id: string | null;
  ticket_type_name: string | null;
  price_huf: number;
  code: string;
  status: TicketStatus;
  used_at: string | null;
  tacito_invoice_id: string | null;
  tacito_invoice_number: string | null;
  tacito_nav_outcome: string | null;
  tacito_error: string | null;
  /** Number of the issued storno (cancellation) invoice — see migrations/20261125_rk_ticket_storno.sql. */
  tacito_storno_number: string | null;
  emailed_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: SupabaseClient | null = null;

/** Service-role client, or null when the env config is missing (routes answer 503). */
export function getTicketDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  if (!client) {
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return client;
}

function db(): SupabaseClient {
  const current = getTicketDb();
  if (!current) {
    throw new Error(
      "[ticket-db] Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return current;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date (`YYYY-MM-DD`) in the Europe/Budapest timezone. */
export function todayIsoInBudapest(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
}

function fail(what: string, error: { message: string } | null): Error {
  return new Error(`[ticket-db] ${what} failed: ${error?.message ?? "unknown error"}`);
}

// ---------------------------------------------------------------------------
// Concerts
// ---------------------------------------------------------------------------

export async function getConcert(concertId: string): Promise<RkConcert | null> {
  const { data, error } = await db()
    .from("rk_concerts")
    .select("*")
    .eq("concert_id", concertId)
    .maybeSingle();
  if (error) throw fail("getConcert", error);
  return (data as RkConcert | null) ?? null;
}

export type ConcertUpsert = Pick<RkConcert, "concert_id" | "title"> & {
  event_date?: string | null;
  event_time?: string | null;
  location?: string | null;
  venue?: string | null;
};

/**
 * Inserts or refreshes the Supabase mirror of a concert. On conflict only the
 * columns in the payload are written, so `status`, `created_at` and
 * `updated_at` history of an existing row survive a PATCH.
 */
export async function upsertConcert(row: ConcertUpsert): Promise<RkConcert> {
  const { data, error } = await db()
    .from("rk_concerts")
    .upsert({ ...row, updated_at: nowIso() }, { onConflict: "concert_id" })
    .select()
    .single();
  if (error || !data) throw fail("upsertConcert", error);
  return data as RkConcert;
}

/** Sets a concert's status (draft/on_sale/sold_out/closed). Null when the row does not exist. */
export async function setConcertStatus(
  concertId: string,
  status: ConcertStatus,
): Promise<RkConcert | null> {
  const { data, error } = await db()
    .from("rk_concerts")
    .update({ status, updated_at: nowIso() })
    .eq("concert_id", concertId)
    .select()
    .maybeSingle();
  if (error) throw fail("setConcertStatus", error);
  return (data as RkConcert | null) ?? null;
}

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

export async function getTicketTypes(concertId: string): Promise<RkTicketType[]> {
  const { data, error } = await db()
    .from("rk_ticket_types")
    .select("*")
    .eq("concert_id", concertId)
    .order("sort")
    .order("created_at");
  if (error) throw fail("getTicketTypes", error);
  return (data ?? []) as RkTicketType[];
}

export type TicketTypeUpsert = {
  id: string;
  concert_id: string;
  name: string;
  kind: TicketKind;
  price_huf: number;
  capacity: number | null;
  sales_start: string | null;
  sales_end: string | null;
  active: boolean;
  sort: number;
  stripe_price_id: string | null;
  stripe_lookup_key: string | null;
};

/**
 * Syncs the ticket types of a concert: every row in the payload is upserted by
 * id (existing rows keep their `sold`/`created_at` — those columns are not in
 * the payload), every existing row NOT in the payload is deactivated
 * (`active=false`, rows are never deleted because orders reference them).
 * Returns the final, sorted list of types.
 */
export async function upsertTicketTypes(
  concertId: string,
  rows: TicketTypeUpsert[],
): Promise<RkTicketType[]> {
  const existing = await getTicketTypes(concertId);
  const keptIds = new Set(rows.map((row) => row.id));
  const removed = existing.filter((type) => !keptIds.has(type.id));

  if (rows.length > 0) {
    const { error } = await db().from("rk_ticket_types").upsert(rows, { onConflict: "id" });
    if (error) throw fail("upsertTicketTypes", error);
  }
  if (removed.length > 0) {
    const { error } = await db()
      .from("rk_ticket_types")
      .update({ active: false })
      .in("id", removed.map((type) => type.id));
    if (error) throw fail("upsertTicketTypes (deactivate)", error);
  }
  return getTicketTypes(concertId);
}

// ---------------------------------------------------------------------------
// Aggregates (read-only; `sold` is maintained by the purchase pipeline)
// ---------------------------------------------------------------------------

export type ConcertSales = {
  concert: RkConcert;
  types: RkTicketType[];
  sold: number;
  capacity: number | null;
  revenue_huf: number;
  orders_count: number;
};

/** All concerts with their types and sold/capacity/revenue/orders aggregates. */
export async function listConcertsWithSales(): Promise<ConcertSales[]> {
  const client = db();
  const [concertsRes, typesRes, ordersRes] = await Promise.all([
    client.from("rk_concerts").select("*").order("event_date"),
    client.from("rk_ticket_types").select("*").order("concert_id").order("sort"),
    client.from("rk_orders").select("id,concert_id"),
  ]);
  if (concertsRes.error) throw fail("listConcertsWithSales (concerts)", concertsRes.error);
  if (typesRes.error) throw fail("listConcertsWithSales (types)", typesRes.error);
  if (ordersRes.error) throw fail("listConcertsWithSales (orders)", ordersRes.error);

  const concerts = (concertsRes.data ?? []) as RkConcert[];
  const types = (typesRes.data ?? []) as RkTicketType[];
  const orders = (ordersRes.data ?? []) as { id: string; concert_id: string }[];

  const ordersByConcert = new Map<string, number>();
  for (const order of orders) {
    ordersByConcert.set(order.concert_id, (ordersByConcert.get(order.concert_id) ?? 0) + 1);
  }

  return concerts.map((concert) => {
    const own = types.filter((type) => type.concert_id === concert.concert_id);
    const capped = own.filter((type) => type.capacity !== null);
    return {
      concert,
      types: own,
      sold: own.reduce((sum, type) => sum + type.sold, 0),
      capacity: capped.length > 0 ? capped.reduce((sum, type) => sum + (type.capacity ?? 0), 0) : null,
      revenue_huf: own.reduce((sum, type) => sum + type.sold * type.price_huf, 0),
      orders_count: ordersByConcert.get(concert.concert_id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Orders + tickets
// ---------------------------------------------------------------------------

export async function listOrders(concertId: string): Promise<RkOrder[]> {
  const { data, error } = await db()
    .from("rk_orders")
    .select("*")
    .eq("concert_id", concertId)
    .order("created_at", { ascending: false });
  if (error) throw fail("listOrders", error);
  return (data ?? []) as RkOrder[];
}

export async function listTicketsForOrder(orderId: string): Promise<RkTicket[]> {
  const { data, error } = await db()
    .from("rk_tickets")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw fail("listTicketsForOrder", error);
  return (data ?? []) as RkTicket[];
}

// ---------------------------------------------------------------------------
// TACITo status tile (the DB half of the card 04 health endpoint)
// ---------------------------------------------------------------------------

export type TacitoStatusData = {
  counts: {
    issued_total: number;
    pending_tickets: number;
    nav_error_tickets: number;
    issued_today: number;
  };
  last_error: {
    ticket_id: string;
    ticket_code: string;
    message: string;
    occurred_at: string;
  } | null;
};

/** `YYYY-MM-DD` of an ISO timestamp in Europe/Budapest. */
function budapestDateOf(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date(iso));
}

/**
 * DB-side half of the TACITo health endpoint: how many tickets have an
 * invoice, how many still need one (paid order, ticket not void, no invoice
 * yet), how many carry a NAV error outcome, how many were invoiced today
 * (Europe/Budapest), and the most recent `tacito_error`.
 *
 * `issued_today` uses the ticket row's `created_at` (the schema has no
 * invoiced-at column; with the cron keeping up the two fall on the same day).
 * `occurred_at` of `last_error` is that ticket's `created_at` for the same
 * reason.
 */
export async function getTacitoStatusData(): Promise<TacitoStatusData> {
  const client = db();
  const [ticketsRes, ordersRes] = await Promise.all([
    client
      .from("rk_tickets")
      .select("id,code,status,tacito_invoice_id,tacito_nav_outcome,tacito_error,created_at,order_id"),
    client.from("rk_orders").select("id,status"),
  ]);
  if (ticketsRes.error) throw fail("getTacitoStatusData (tickets)", ticketsRes.error);
  if (ordersRes.error) throw fail("getTacitoStatusData (orders)", ordersRes.error);

  type TicketRow = {
    id: string;
    code: string;
    status: string;
    tacito_invoice_id: string | null;
    tacito_nav_outcome: string | null;
    tacito_error: string | null;
    created_at: string;
    order_id: string;
  };
  const tickets = (ticketsRes.data ?? []) as TicketRow[];
  const orders = (ordersRes.data ?? []) as { id: string; status: string }[];
  const orderStatusById = new Map(orders.map((order) => [order.id, order.status]));

  const pending = tickets.filter(
    (ticket) =>
      !ticket.tacito_invoice_id &&
      ticket.status !== "void" &&
      orderStatusById.get(ticket.order_id) === "paid",
  );
  const errored = tickets
    .filter((ticket) => ticket.tacito_error)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const today = todayIsoInBudapest();

  return {
    counts: {
      issued_total: tickets.filter((ticket) => ticket.tacito_invoice_id).length,
      pending_tickets: pending.length,
      nav_error_tickets: tickets.filter((ticket) => ticket.tacito_nav_outcome === "ERROR").length,
      issued_today: tickets.filter(
        (ticket) => ticket.tacito_invoice_id && budapestDateOf(ticket.created_at) === today,
      ).length,
    },
    last_error: errored[0]
      ? {
          ticket_id: errored[0].id,
          ticket_code: errored[0].code,
          message: errored[0].tacito_error ?? "",
          occurred_at: errored[0].created_at,
        }
      : null,
  };
}
