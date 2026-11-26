import { NextResponse, type NextRequest } from "next/server";

import { signOrderToken } from "@/lib/order-token";
import { fulfilFreeOrder, FREE_ORDER_MARKER } from "@/lib/ticket-fulfil";
import {
  getConcert,
  getTicketDb,
  getTicketTypes,
  type RkTicket,
  type RkTicketType,
} from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public free-ticket request path (card 11): POST /api/tickets/free
 * `{concert_id, ticket_type_id, quantity (1–2), buyer:{name,email}, accept_terms:true}`.
 *
 * A ticket type with `price_huf = 0` is an ingyenes jegy — it never touches
 * Stripe (no price object, no Checkout Session) and this endpoint is its only
 * request path. Validation mirrors checkout: concert `on_sale`, the type
 * active, inside its sales window, capacity left — plus the card's abuse
 * guards, in the order the card lists them:
 *
 *   1. max 2 free tickets per e-mail per concert (existing free tickets of
 *      the e-mail on this concert, counted from the DB, + the request must
 *      stay ≤ 2);
 *   2. the per-order cap of 6 overall holds by construction — the request
 *      shape allows a single type with quantity 1–2, so one order can never
 *      carry more than 2 free tickets (lib/ticket-checkout's
 *      MAX_TOTAL_QUANTITY is the paid-flow twin of this rule);
 *   3. one request per e-mail per 60 seconds — a simple in-DB check on the
 *      latest order for that e-mail (any concert; the cap above gives the
 *      more specific message first, so both refusals stay observable).
 *
 * The order is inserted as `pending` with the `FREE` marker in
 * `stripe_payment_intent` (no new columns), then fulfilled through the exact
 * shared path a paid webhook fulfilment uses: mark paid, create the tickets,
 * increment `sold`, flip the concert to `sold_out` at capacity, send the
 * ticket e-mail. Free orders are excluded from TACITo invoicing by their
 * `amount_huf = 0` (lib/tacito-cron) — no számla for 0 Ft.
 *
 * The response carries a signed confirmation token (lib/order-token) so
 * /jegyek/koszonjuk can look the order up without ever accepting a bare
 * order id. If no signing secret is configured the token is omitted and the
 * success page falls back to its plain confirmation state.
 */

/** Card 11: an ingyenes jegy request allows 1–2 tickets of ONE type. */
const MAX_FREE_QUANTITY = 2;
/** Card 11: max free tickets per e-mail per concert. */
const MAX_FREE_PER_EMAIL_PER_CONCERT = 2;
/** Card 11: one request per e-mail per 60 seconds. */
const RATE_LIMIT_MS = 60_000;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type FreeRequest = {
  concert_id: string;
  ticket_type_id: string;
  quantity: number;
  buyer: { name: string; email: string };
};

function parseFreeRequest(raw: unknown): { request: FreeRequest } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "Hibás kérés." };
  const body = raw as Record<string, unknown>;

  if (typeof body.concert_id !== "string" || body.concert_id.trim().length === 0) {
    return { error: "Hiányzó koncert-azonosító." };
  }
  if (typeof body.ticket_type_id !== "string" || body.ticket_type_id.trim().length === 0) {
    return { error: "Hiányzó jegytípus-azonosító." };
  }
  const quantity = body.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_FREE_QUANTITY
  ) {
    return { error: `Egy igénylésben ${MAX_FREE_QUANTITY} ingyenes jegy kérhető.` };
  }
  if (typeof body.buyer !== "object" || body.buyer === null) {
    return { error: "Hiányzó igénylői adatok." };
  }
  const buyerRaw = body.buyer as Record<string, unknown>;
  if (
    typeof buyerRaw.name !== "string" ||
    buyerRaw.name.trim().length < 2 ||
    buyerRaw.name.trim().length > 100
  ) {
    return { error: "A név megadása kötelező (2–100 karakter)." };
  }
  if (
    typeof buyerRaw.email !== "string" ||
    !EMAIL_RE.test(buyerRaw.email.trim()) ||
    buyerRaw.email.trim().length > 200
  ) {
    return { error: "Érvényes e-mail-cím megadása kötelező." };
  }

  return {
    request: {
      concert_id: body.concert_id.trim(),
      ticket_type_id: body.ticket_type_id.trim(),
      quantity,
      buyer: {
        name: buyerRaw.name.trim(),
        email: buyerRaw.email.trim().toLowerCase(),
      },
    },
  };
}

/** Existing, non-void free tickets of the e-mail on this concert (paid orders, 0 Ft). */
async function countExistingFreeTickets(
  concertId: string,
  email: string,
): Promise<number> {
  const db = getTicketDb();
  if (!db) throw new Error("[api/tickets/free] Supabase is not configured");
  const { count, error } = await db
    .from("rk_tickets")
    .select("id, order:rk_orders!inner(id)", { count: "exact", head: true })
    .eq("concert_id", concertId)
    .neq("status", "void")
    .eq("rk_orders.buyer_email", email)
    .eq("rk_orders.amount_huf", 0)
    .eq("rk_orders.status", "paid");
  if (error) {
    throw new Error(`[api/tickets/free] free-ticket count failed: ${error.message}`);
  }
  return count ?? 0;
}

/** True when the e-mail's latest order (any concert, any status) is under 60 seconds old. */
async function latestOrderTooFresh(email: string): Promise<boolean> {
  const db = getTicketDb();
  if (!db) throw new Error("[api/tickets/free] Supabase is not configured");
  const { data, error } = await db
    .from("rk_orders")
    .select("id,created_at")
    .eq("buyer_email", email)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`[api/tickets/free] rate-limit read failed: ${error.message}`);
  }
  const latest = (data ?? []) as { created_at: string }[];
  if (latest.length === 0) return false;
  return Date.parse(latest[0].created_at) > Date.now() - RATE_LIMIT_MS;
}

export async function POST(req: NextRequest) {
  const db = getTicketDb();
  if (!db) {
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

  // Terms gate first — nothing is even parsed without it.
  const acceptTerms = (body as { accept_terms?: unknown } | null)?.accept_terms;
  if (acceptTerms !== true) {
    return NextResponse.json(
      { error: "terms_required", message: "A vásárlási feltételek elfogadása kötelező." },
      { status: 400 },
    );
  }

  const parsed = parseFreeRequest(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: "bad_request", message: parsed.error }, { status: 400 });
  }
  const request = parsed.request;

  try {
    const concert = await getConcert(request.concert_id);
    if (!concert) {
      return NextResponse.json({ error: "no_concert", message: "Nincs ilyen koncert." }, { status: 404 });
    }
    if (concert.status !== "on_sale") {
      return NextResponse.json(
        { error: "not_on_sale", message: "A koncert jegyértékesítése jelenleg nincs folyamatban." },
        { status: 409 },
      );
    }

    const types = await getTicketTypes(request.concert_id);
    const type = types.find((entry) => entry.id === request.ticket_type_id) as RkTicketType | undefined;
    if (!type) {
      return NextResponse.json(
        { error: "unknown_ticket_type", message: "Nincs ilyen jegytípus a koncerten." },
        { status: 400 },
      );
    }
    if (!type.active) {
      return NextResponse.json(
        { error: "type_inactive", message: "Ez a jegytípus már nem kapható." },
        { status: 400 },
      );
    }
    if (type.price_huf !== 0) {
      return NextResponse.json(
        { error: "not_free_type", message: "Ez a jegytípus nem ingyenes." },
        { status: 400 },
      );
    }
    const now = Date.now();
    if (type.sales_start && now < Date.parse(type.sales_start)) {
      return NextResponse.json(
        { error: "outside_sales_window", message: "Az elővétel ennél a jegytípusnál még nem kezdődött el." },
        { status: 400 },
      );
    }
    if (type.sales_end && now > Date.parse(type.sales_end)) {
      return NextResponse.json(
        { error: "outside_sales_window", message: "Az elővétel ennél a jegytípusnál már lejárt." },
        { status: 400 },
      );
    }

    // Abuse guard 1: max free tickets per e-mail per concert.
    const existing = await countExistingFreeTickets(request.concert_id, request.buyer.email);
    if (existing + request.quantity > MAX_FREE_PER_EMAIL_PER_CONCERT) {
      return NextResponse.json(
        {
          error: "free_email_cap",
          message: `Erre a koncertre ezzel az e-mail-címmel legfeljebb ${MAX_FREE_PER_EMAIL_PER_CONCERT} ingyenes jegy kérhető.`,
        },
        { status: 409 },
      );
    }

    // Abuse guard 3: one request per e-mail per 60 seconds.
    if (await latestOrderTooFresh(request.buyer.email)) {
      return NextResponse.json(
        { error: "too_many_requests", message: "Túl sok kérés, próbálja később." },
        { status: 429 },
      );
    }

    // Business rule: capacity must still cover the request.
    if (type.capacity !== null && type.sold + request.quantity > type.capacity) {
      return NextResponse.json(
        { error: "sold_out", message: "Erre a jegytípusra már nincs jegy." },
        { status: 409 },
      );
    }

    // The free order: pending + the FREE marker (reuse of
    // stripe_payment_intent — no new columns), no Stripe session.
    const { data: order, error: insertError } = await db
      .from("rk_orders")
      .insert({
        concert_id: concert.concert_id,
        buyer_name: request.buyer.name,
        buyer_email: request.buyer.email,
        amount_huf: 0,
        currency: "HUF",
        status: "pending",
        stripe_payment_intent: FREE_ORDER_MARKER,
      })
      .select()
      .single();
    if (insertError || !order) {
      throw new Error(`[api/tickets/free] rk_orders insert failed: ${insertError?.message ?? "unknown error"}`);
    }

    // Fulfil through the exact shared path a paid session uses.
    const fulfil = await fulfilFreeOrder(order.id, [{ type, quantity: request.quantity }]);
    if (fulfil.outcome !== "fulfilled") {
      const why =
        "reason" in fulfil ? fulfil.reason : `unexpected state: ${fulfil.outcome} (${fulfil.ticketCount} tickets)`;
      console.error(`[api/tickets/free] fulfilment of order ${order.id} could not run: ${why}`);
      return NextResponse.json(
        { error: "fulfilment_failed", message: "Nem sikerült kiállítani a jegyet. Kérem, próbálja újra." },
        { status: 500 },
      );
    }

    const tickets = fulfil.tickets as RkTicket[];
    const token = signOrderToken(order.id);
    return NextResponse.json({
      order_id: order.id,
      status: "paid",
      amount_huf: 0,
      tickets: tickets.map((ticket) => ({
        code: ticket.code,
        ticket_type_name: ticket.ticket_type_name,
        price_huf: ticket.price_huf,
      })),
      email_sent: fulfil.email.ok,
      ...(token ? { token } : {}),
    });
  } catch (err) {
    console.error("[api/tickets/free] POST failed:", err);
    return NextResponse.json(
      { error: "free_request_failed", message: "Nem sikerült igényelni a jegyet." },
      { status: 500 },
    );
  }
}
