/**
 * TACITo cron orchestration (card 04): the shared bodies behind
 * /api/cron/tacito-invoices, /api/cron/tacito-events and /api/cron/tacito.
 *
 * Every step is idempotent on its reference, so the crons can be re-run any
 * time (Vercel cron, manual curl) without duplicate invoices:
 * - a ticket without `tacito_invoice_id` is invoiced via `createAndIssue`
 *   (`rezkorut:ticket-<id>` → `:create` / `:issue`); a crash between the two
 *   steps resumes on the next run with the same keys;
 * - the e-mail step (`POST /invoices/<id>/send`, never retried by the client)
 *   happens after the invoice id/number/outcome are stored;
 * - a refunded ticket's invoice is stornoed once: the invoice's `related` list
 *   on TACITo is checked before creating a new storno draft, so even a crash
 *   mid-storno cannot produce a second cancellation;
 * - the events feed advances `rk_tacito_cursor.next_cursor` page by page and
 *   mirrors `nav_outcome` onto `rk_tickets` by `tacito_invoice_id`.
 *
 * Node type-stripping compatibility: no parameter properties, no enums.
 */

import type { NextRequest } from "next/server";

import {
  buildTicketInvoice,
  formatTacitoError,
  getTacitoClient,
  ticketReference,
  TacitoClient,
  TacitoError,
  type TacitoEvent,
} from "@/lib/tacito";
import {
  getConcert,
  getTicketDb,
  type RkConcert,
  type RkOrder,
  type RkTicket,
} from "@/lib/ticket-db";

/** Hard cap per run: 25 invoices (the API key allows 10 req/s — stay polite). */
export const TACITO_INVOICES_PER_RUN = 25;
/** Refunds are owner-issued and rare; a small cap keeps the run bounded. */
const TACITO_STORNOS_PER_RUN = 25;
/** The events feed page size. */
const EVENTS_PAGE_LIMIT = 100;
/** Safety bound so a poisoned cursor cannot loop forever. */
const EVENTS_MAX_PAGES = 50;

function db() {
  const client = getTicketDb();
  if (!client) {
    throw new Error("[tacito-cron] Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return client;
}

function tacito(): TacitoClient {
  const client = getTacitoClient();
  if (!client) {
    throw new Error("[tacito-cron] TACITO_API_KEY is not set");
  }
  return client;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Vercel cron (and any manual run) authenticates with `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Invoices: one számla per sold ticket
// ---------------------------------------------------------------------------

type PendingTicket = {
  ticket: RkTicket;
  order: RkOrder;
};

export type TacitoInvoicesRunResult = {
  issued: number;
  failed: number;
  /** Tickets still needing an invoice after this run. */
  pending: number;
  stornoed: number;
  details: { ticket_code: string; invoice_number: string | null; error: string | null }[];
  /** Draft mode only: the per-ticket allocated gross prices that would be invoiced. */
  draft_details: { ticket_code: string; order_id: string; unit_price_gross: number }[];
};

/** Tickets of PAID orders, not void, no invoice yet — oldest first, capped per run. */
async function selectPendingTickets(limit: number): Promise<PendingTicket[]> {
  const { data, error } = await db()
    .from("rk_tickets")
    .select(
      "*, order:rk_orders!inner(id, concert_id, buyer_name, buyer_email, buyer_phone, buyer_company, buyer_tax_number, address_country, address_postal, address_city, address_street, amount_huf, currency, stripe_session_id, stripe_payment_intent, status, paid_at, refunded_at, tacito_error, discount_code, discount_huf, created_at)",
    )
    .neq("status", "void")
    .is("tacito_invoice_id", null)
    .eq("rk_orders.status", "paid")
    // Card 11: free (0 Ft) orders never get a TACITo invoice — no számla for
    // an ingyenes jegy. They are `paid` too, so the amount must filter them.
    .gt("rk_orders.amount_huf", 0)
    // Card 12: the ticket-level twin — a discounted order (amount > 0) can
    // still contain a 0 Ft ticket („Kedvezmény miatt 0 Ft"): its allocated
    // gross price is 0, so it is invoiced at nothing and never queues.
    // (Plain column name: on the BASE table the dotted embedded-resource
    // path is not accepted by PostgREST.)
    .gt("price_huf", 0)
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`[tacito-cron] pending tickets read failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ticket: row as unknown as RkTicket,
    order: row.order as unknown as RkOrder,
  }));
}

/** Count of tickets still needing an invoice (paid order, not void, no invoice). */
async function countPendingTickets(): Promise<number> {
  // The joined `order` must be part of the select for the embedded filter to
  // be accepted (with head:true the plain column list drops it otherwise).
  const { count, error } = await db()
    .from("rk_tickets")
    .select("id, order:rk_orders!inner(id)", { count: "exact", head: true })
    .neq("status", "void")
    .is("tacito_invoice_id", null)
    .eq("rk_orders.status", "paid")
    // Card 11: free (0 Ft) orders never queue for invoicing.
    .gt("rk_orders.amount_huf", 0)
    // Card 12: 0 Ft tickets of discounted orders never queue either.
    .gt("price_huf", 0);
  if (error) throw new Error(`[tacito-cron] pending tickets count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Card 12: order ids that contain at least one non-void 0 Ft ticket — the
 * orders whose allocation produced a free ticket. Their invoice note says
 * „Kedvezmény miatt 0 Ft” on every issued számla of the order. One query per
 * run (the set is small: free tickets are the exception, not the rule).
 */
async function orderIdsWithZeroPricedTicket(): Promise<Set<string>> {
  const { data, error } = await db()
    .from("rk_tickets")
    .select("order_id")
    .eq("price_huf", 0)
    .neq("status", "void");
  if (error) throw new Error(`[tacito-cron] zero-priced tickets read failed: ${error.message}`);
  return new Set(((data ?? []) as { order_id: string }[]).map((row) => row.order_id));
}

async function setTicketError(ticketId: string, message: string): Promise<void> {
  const { error } = await db().from("rk_tickets").update({ tacito_error: message }).eq("id", ticketId);
  if (error) console.error(`[tacito-cron] tacito_error write failed for ticket ${ticketId}:`, error.message);
}

/**
 * One cron pass: invoice up to 25 pending tickets, then storno refunded ones.
 * A non-retryable 4xx stores `rk_tickets.tacito_error` and the run continues
 * with the next ticket; transient (retryable) failures also land in
 * `tacito_error` and are simply retried by the next cron run.
 *
 * `draft` (card 12 verification, also useful as a dry run): NO invoice is
 * issued and NOTHING is stored or sent — each pending ticket's payload is
 * created as a TACITo draft under `<reference>:draft` (a separate key, so a
 * later real invoice under `<reference>:create` is untouched), its
 * allocated gross price is reported in `draft_details`, and the draft is
 * deleted again.
 *
 * `deadlineMs` (default 240 s): when the elapsed time crosses it, the pass
 * stops before starting the next ticket so the route can still answer with
 * its summary inside the 300 s Hobby function limit — every finished ticket
 * is already stored, the rest stay pending for the next run.
 */
export async function runTacitoInvoices(
  options: { limit?: number; deadlineMs?: number; draft?: boolean } = {},
): Promise<TacitoInvoicesRunResult> {
  const client = tacito();
  const draft = options.draft === true;
  const limit = Math.min(options.limit ?? TACITO_INVOICES_PER_RUN, TACITO_INVOICES_PER_RUN);
  const deadline = Date.now() + Math.min(options.deadlineMs ?? 240_000, 240_000);
  const concerts = new Map<string, RkConcert | null>();

  async function concertOf(concertId: string): Promise<RkConcert | null> {
    if (!concerts.has(concertId)) {
      concerts.set(concertId, await getConcert(concertId).catch((error: unknown) => {
        console.error(`[tacito-cron] concert read failed for ${concertId}:`, error);
        return null;
      }));
    }
    return concerts.get(concertId) ?? null;
  }

  const pending = await selectPendingTickets(limit);
  // Card 12: which orders contain a 0 Ft (free) ticket — only fetched when
  // there is anything to invoice (one query per run).
  const zeroOrders = pending.length > 0 ? await orderIdsWithZeroPricedTicket() : new Set<string>();
  const result: TacitoInvoicesRunResult = {
    issued: 0,
    failed: 0,
    pending: 0,
    stornoed: 0,
    details: [],
    draft_details: [],
  };

  for (const { ticket, order } of pending) {
    if (Date.now() > deadline) {
      console.warn("[tacito-cron] time budget reached — remaining tickets stay pending for the next run");
      break;
    }
    if (draft) {
      // Draft mode: create the draft (TACITo validates the payload exactly
      // like a real create), report the allocated gross price, delete it.
      const reference = `${ticketReference(ticket.id)}:draft`;
      try {
        const concert = await concertOf(ticket.concert_id);
        const { payload } = buildTicketInvoice(order, ticket, concert, {
          orderHasZeroPricedTicket: zeroOrders.has(order.id),
        });
        const gross = Number(payload.lines[0]?.unit_price_gross ?? 0);
        const draftInvoice = await client.createDraft(reference, payload);
        result.draft_details.push({
          ticket_code: ticket.code,
          order_id: order.id,
          unit_price_gross: gross,
        });
        try {
          await client.deleteDraft(draftInvoice.id);
        } catch (error) {
          console.warn(
            `[tacito-cron] draft ${draftInvoice.id} of ticket ${ticket.code} could not be deleted (harmless — it stays a draft, never issued):`,
            formatTacitoError(error),
          );
        }
      } catch (error) {
        const message = formatTacitoError(error);
        result.failed += 1;
        result.details.push({ ticket_code: ticket.code, invoice_number: null, error: message });
        console.error(`[tacito-cron] draft-mode create failed for ticket ${ticket.code}:`, message);
      }
      continue;
    }

    const reference = ticketReference(ticket.id);
    try {
      const concert = await concertOf(ticket.concert_id);
      const { payload } = buildTicketInvoice(order, ticket, concert, {
        orderHasZeroPricedTicket: zeroOrders.has(order.id),
      });
      const invoice = await client.createAndIssue(reference, payload);

      // Store first (the invoice exists from here on, whatever happens next).
      const { error: storeError } = await db()
        .from("rk_tickets")
        .update({
          tacito_invoice_id: invoice.id,
          tacito_invoice_number: invoice.invoice_number ?? null,
          tacito_nav_outcome: invoice.nav_outcome ?? null,
          tacito_error: null,
        })
        .eq("id", ticket.id);
      if (storeError) throw new Error(`rk_tickets store failed: ${storeError.message}`);

      // Then e-mail the buyer (single attempt; auto-send is off and issue
      // was told send_email:false, so this is the only send).
      let sendError: string | null = null;
      try {
        await client.sendInvoice(invoice.id);
      } catch (error) {
        sendError = `TACITo send: ${formatTacitoError(error).replace(/^TACITo /, "")}`;
      }
      if (sendError) {
        await setTicketError(ticket.id, sendError);
        result.failed += 1;
        result.details.push({ ticket_code: ticket.code, invoice_number: invoice.invoice_number ?? null, error: sendError });
      } else {
        result.issued += 1;
        result.details.push({ ticket_code: ticket.code, invoice_number: invoice.invoice_number ?? null, error: null });
      }
    } catch (error) {
      const message = formatTacitoError(error);
      await setTicketError(ticket.id, message);
      result.failed += 1;
      result.details.push({ ticket_code: ticket.code, invoice_number: null, error: message });
      if (error instanceof TacitoError && error.retryable) {
        console.warn(`[tacito-cron] transient invoicing failure for ticket ${ticket.code}:`, message);
      } else {
        console.error(`[tacito-cron] invoicing failed for ticket ${ticket.code}:`, message);
      }
    }
  }

  // Storno pass runs in the same cron (card: "run this in the invoices cron").
  // Draft mode never performs real writes, so it is skipped there.
  if (!draft) {
    result.stornoed = await runTacitoStornos(client);
  }

  result.pending = await countPendingTickets();
  return result;
}

// ---------------------------------------------------------------------------
// Storno: cancel the invoice of a refunded ticket, exactly once
// ---------------------------------------------------------------------------

type RefundedTicket = { ticket: RkTicket; order: RkOrder };

async function selectRefundedWithInvoice(limit: number): Promise<RefundedTicket[]> {
  // `select("*")` on purpose: it works whether or not the additive
  // tacito_storno_number column has been applied to the live DB yet.
  const { data, error } = await db()
    .from("rk_tickets")
    .select("*, order:rk_orders!inner(id, concert_id, buyer_name, buyer_email, buyer_phone, buyer_company, buyer_tax_number, address_country, address_postal, address_city, address_street, amount_huf, currency, stripe_session_id, stripe_payment_intent, status, paid_at, refunded_at, tacito_error, created_at)")
    .eq("rk_orders.status", "refunded")
    .not("tacito_invoice_id", "is", null)
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`[tacito-cron] refunded tickets read failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ticket: row as unknown as RkTicket,
    order: row.order as unknown as RkOrder,
  }));
}

/** Store the storno number; log (once per run) when the column is not applied yet. */
async function storeStornoNumber(ticketId: string, stornoNumber: string): Promise<boolean> {
  const { error } = await db()
    .from("rk_tickets")
    .update({ tacito_storno_number: stornoNumber })
    .eq("id", ticketId);
  if (error) {
    if (/tacito_storno_number|PGRST204|does not exist/i.test(error.message)) {
      console.warn(
        `[tacito-cron] rk_tickets.tacito_storno_number is not in the live DB yet (run supabase/migrations/20261125_rk_ticket_storno.sql); the storno is done in TACITo, its number is not cached.`,
      );
    } else {
      console.error(`[tacito-cron] storno number store failed for ticket ${ticketId}:`, error.message);
    }
    return false;
  }
  return true;
}

/**
 * Storno pass: for every refunded ticket that has an invoice and no stored
 * storno number — check the invoice's `related` list first (crash recovery:
 * a storno draft created by a previous crashed run is issued, not duplicated),
 * then create + issue the storno under `rezkorut:ticket-<id>:refund`.
 */
export async function runTacitoStornos(client: TacitoClient, limit: number = TACITO_STORNOS_PER_RUN): Promise<number> {
  const rows = await selectRefundedWithInvoice(limit);
  let stornoed = 0;

  for (const { ticket } of rows) {
    // Fast path: the number is already stored — nothing to do.
    if (ticket.tacito_storno_number) continue;

    const reference = `${ticketReference(ticket.id)}:refund`;
    const invoiceId = ticket.tacito_invoice_id as string;
    try {
      const detail = await client.invoiceDetail(invoiceId);
      const related = detail.related ?? [];
      const issuedStorno = related.find((item) => item.relation_kind === "STORNO" && item.state === "ISSUED");
      const stornoDraft = related.find((item) => item.relation_kind === "STORNO" && item.state === "DRAFT");

      let stornoNumber: string | null = null;
      if (issuedStorno) {
        stornoNumber = issuedStorno.invoice_number ?? issuedStorno.id;
      } else if (stornoDraft) {
        // A previous run created the draft but crashed before issuing it.
        const issued = await client.issueStornoDraft(stornoDraft.id, reference);
        stornoNumber = issued.invoice_number ?? issued.id;
      } else {
        const draft = await client.stornoDraft(invoiceId, reference);
        const issued = await client.issueStornoDraft(draft.id, reference);
        stornoNumber = issued.invoice_number ?? issued.id;
      }

      await storeStornoNumber(ticket.id, stornoNumber);
      // Clear a previous storno attempt's error, if any.
      const { error: clearError } = await db().from("rk_tickets").update({ tacito_error: null }).eq("id", ticket.id);
      if (clearError) console.error(`[tacito-cron] tacito_error clear failed for ticket ${ticket.id}:`, clearError.message);
      stornoed += 1;
    } catch (error) {
      const message = formatTacitoError(error);
      await setTicketError(ticket.id, `TACITo storno: ${message}`);
      console.error(`[tacito-cron] storno failed for ticket ${ticket.code}:`, message);
    }
  }
  return stornoed;
}

// ---------------------------------------------------------------------------
// Events: mirror NAV outcomes into rk_tickets
// ---------------------------------------------------------------------------

export type TacitoEventsRunResult = {
  pages: number;
  processed: number;
  updated: number;
  cursor: string | null;
};

const NAV_OUTCOME_MAP: Record<string, string> = {
  DONE: "ACCEPTED",
  DONE_WITH_WARNINGS: "ACCEPTED",
  REJECTED: "ERROR",
  FAILED: "ERROR",
  XML_INVALID: "ERROR",
  NAV_CONFIG_ERROR: "ERROR",
  CHAIN_HOLD: "ERROR",
  DUPLICATE_HOLD: "ERROR",
  PDF_HOLD: "ERROR",
};

/**
 * The raw `nav_status` an event carries → the grouped `nav_outcome` the app
 * stores (mapping from TACITo's API documentation).
 */
export function mapNavOutcome(navStatus: string | null | undefined): string | null {
  if (!navStatus) return null;
  if (navStatus in NAV_OUTCOME_MAP) return NAV_OUTCOME_MAP[navStatus];
  if (["NOT_CONFIGURED", "NOT_REPORTABLE", "VOIDED"].includes(navStatus)) return navStatus;
  return "IN_PROGRESS";
}

async function readCursor(): Promise<string | null> {
  const { data, error } = await db().from("rk_tacito_cursor").select("next_cursor").eq("id", 1).maybeSingle();
  if (error) throw new Error(`[tacito-cron] cursor read failed: ${error.message}`);
  return (data?.next_cursor as string | null) ?? null;
}

async function saveCursor(cursor: string): Promise<void> {
  const { error } = await db()
    .from("rk_tacito_cursor")
    .upsert({ id: 1, next_cursor: cursor, updated_at: nowIso() }, { onConflict: "id" });
  if (error) throw new Error(`[tacito-cron] cursor write failed: ${error.message}`);
}

async function applyEvent(event: TacitoEvent): Promise<boolean> {
  const data = event.data ?? {};
  const rawOutcome = typeof data.nav_outcome === "string" ? data.nav_outcome : null;
  const rawStatus = typeof data.nav_status === "string" ? data.nav_status : null;
  const outcome = rawOutcome ?? mapNavOutcome(rawStatus);
  if (!outcome) return false;

  const { data: updated, error } = await db()
    .from("rk_tickets")
    .update({ tacito_nav_outcome: outcome })
    .eq("tacito_invoice_id", event.invoice_id)
    .select("id");
  if (error) throw new Error(`[tacito-cron] nav outcome update failed: ${error.message}`);
  return (updated ?? []).length > 0;
}

/**
 * Events pass: poll `GET /events?after=<cursor>` page by page, mirror each
 * event's NAV outcome onto the ticket that owns `invoice_id`, dedupe by event
 * `id` within the run, persist the page cursor after every page (a crash keeps
 * the progress), stop at `has_more:false`.
 */
export async function runTacitoEvents(options: { maxPages?: number } = {}): Promise<TacitoEventsRunResult> {
  const client = tacito();
  const maxPages = options.maxPages ?? EVENTS_MAX_PAGES;
  const seenEventIds = new Set<string>();

  let after = await readCursor();
  const result: TacitoEventsRunResult = { pages: 0, processed: 0, updated: 0, cursor: after };

  for (let page = 0; page < maxPages; page++) {
    const feed = await client.events({ after: after ?? undefined, limit: EVENTS_PAGE_LIMIT });
    result.pages += 1;

    for (const event of feed.events) {
      // The feed may repeat events inside a window; dedupe by event id.
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      result.processed += 1;
      try {
        if (await applyEvent(event)) result.updated += 1;
      } catch (error) {
        // One bad event must not block the cursor from advancing.
        console.error(`[tacito-cron] event ${event.id} (invoice ${event.invoice_id}) apply failed:`, error);
      }
    }

    // The cursor is always the page's next_cursor: `after` only accepts
    // next_cursor values ("opaque cursor: the next_cursor of the previous
    // page"); event ids are used for dedupe, not as cursors.
    await saveCursor(feed.next_cursor);
    after = feed.next_cursor;
    result.cursor = after;

    if (!feed.has_more) break;
  }
  return result;
}
