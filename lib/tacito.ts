/**
 * TACITo API client (card 04) — thin `fetch` wrapper for the public v1 API
 * (https://tacito.hu/api/v1, OpenAPI: https://tacito.hu/api/openapi.json).
 *
 * Conventions (verified against the live API + tacito-sdk source):
 * - Every business write carries the app-prefixed reference in the
 *   `Idempotency-Key` header: `<reference>:create`, `<reference>:issue`,
 *   `<reference>:storno`, `<reference>:storno-issue`. Replaying a step with
 *   the same key returns the first response instead of a second write, so a
 *   crash between create and issue resumes without a duplicate invoice.
 * - Retries: network errors, 429, 5xx and 409-"Please retry", at most 3
 *   attempts, per-call 30 s timeout. Only reads and calls that carry a
 *   supported Idempotency-Key are retried.
 * - `send` is NEVER retried and carries no key (a retry could e-mail the
 *   buyer twice — the API takes no idempotency key on /send).
 * - The storno draft creation is not retried in-process either: the API's
 *   storno idempotency may be inactive server-side, so the recovery path is
 *   the caller's `related` check (see lib/tacito-cron.ts), not a blind retry.
 * - The API key is only read from `TACITO_API_KEY` and never logged.
 *
 * Node type-stripping compatibility (the verification harness imports this
 * file directly): no parameter properties, no enums.
 */

import type { RkConcert, RkOrder, RkTicket } from "@/lib/ticket-db";

export const TACITO_BASE_URL = "https://tacito.hu/api/v1";

/**
 * The series every ticket invoice is issued in — hard requirement.
 * ELOADO, prefix `2026-J-`. Never rely on the tenant default series.
 */
export const TACITO_SERIES_ID = "364d9564-7486-4f38-b023-7e455724aa1e";

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
/** Waits longer than this are not retried in-process (the cron retries next run). */
const MAX_RETRY_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TacitoError extends Error {
  /** HTTP status; 0 for network errors and timeouts. */
  status: number;
  /** API error code from the response body (`code`), or `network`. */
  code: string | number;
  /** The API's `errors` object (e.g. `errors.json.note`), when present. */
  fieldErrors: Record<string, unknown> | null;
  /** Whether the same call may succeed later (429/5xx/network vs a 4xx bug). */
  retryable: boolean;
  /** `X-Request-Id` of the failing response, when present. */
  requestId: string | null;

  constructor(args: {
    status: number;
    code: string | number;
    message: string;
    fieldErrors?: Record<string, unknown> | null;
    retryable: boolean;
    requestId?: string | null;
  }) {
    super(args.message);
    this.name = "TacitoError";
    this.status = args.status;
    this.code = args.code;
    this.fieldErrors = args.fieldErrors ?? null;
    this.retryable = args.retryable;
    this.requestId = args.requestId ?? null;
  }
}

/** Short, single-line, secret-free rendering of a TacitoError for `rk_tickets.tacito_error`. */
export function formatTacitoError(error: unknown): string {
  if (error instanceof TacitoError) {
    const fields =
      error.fieldErrors && Object.keys(error.fieldErrors).length > 0
        ? ` (${Object.keys(error.fieldErrors).slice(0, 3).join(", ")})`
        : "";
    const suffix = error.requestId ? ` [req ${error.requestId}]` : "";
    return `TACITo ${error.status} ${error.code}: ${error.message}${fields}${suffix}`.slice(0, 500);
  }
  const message = error instanceof Error ? error.message : String(error);
  return `TACITo: ${message}`.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Response shapes (the fields we use; everything else passes through)
// ---------------------------------------------------------------------------

export type TacitoInvoice = {
  id: string;
  state: string;
  invoice_number: string | null;
  series_id: string;
  gross_total: string;
  currency: string;
  nav_outcome: string | null;
  nav_status: string | null;
  exemption_reason_code: string | null;
  legal_basis_code: string | null;
  invoice_kind: string | null;
  original_invoice_id: string | null;
  /** e.g. ["Áfa tv. 187. § szerinti alanyi adómentes"] on an AAM draft. */
  mandatory_tax_texts: unknown;
  warnings?: { code: string; message: string }[];
  [field: string]: unknown;
};

export type TacitoSeries = {
  id: string;
  name: string;
  prefix: string;
  next_number_preview: string;
  is_default: boolean;
  archived_at: string | null;
  [field: string]: unknown;
};

export type TacitoSeriesList = {
  default_series_id: string | null;
  series: TacitoSeries[];
};

export type TacitoReadiness = {
  ready: boolean;
  livemode: boolean;
  missing: { step: string; url?: string }[];
  nav: { configured: boolean; environment: string | null; production_allowed: boolean };
  subscription: { state: string; mutation_allowed: boolean };
  auto_send_invoice_email: boolean;
  [field: string]: unknown;
};

export type TacitoEvent = {
  id: string;
  seq: number;
  type: "invoice.issued" | "invoice.payment_status_changed" | "invoice.nav_status_changed" | string;
  invoice_id: string;
  created_at: string;
  data: Record<string, unknown>;
};

export type TacitoEventPage = {
  events: TacitoEvent[];
  has_more: boolean;
  next_cursor: string;
};

export type TacitoProduct = {
  id: string;
  name: string;
  default_unit: string;
  default_vat_rate: string;
  is_archived: boolean;
  usage_count: number;
  [field: string]: unknown;
};

export type TacitoInvoiceDetail = {
  invoice: TacitoInvoice;
  related: { id: string; invoice_number: string | null; document_type: string; invoice_kind: string | null; relation_kind: string; state: string }[];
  [field: string]: unknown;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type TacitoClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** GETs and key-carrying writes retry on network/429/5xx; the rest do not. */
  retry?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TacitoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: TacitoClientOptions = {}) {
    const key = options.apiKey ?? process.env.TACITO_API_KEY ?? "";
    if (!key) {
      throw new Error("[tacito] TACITO_API_KEY is not set");
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? TACITO_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const retry = options.retry ?? (options.method === "GET" || Boolean(options.idempotencyKey));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        const url = new URL(this.baseUrl + options.path);
        for (const [name, value] of Object.entries(options.query ?? {})) {
          if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
        }
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        };
        if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
        response = await fetch(url, {
          method: options.method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        // Network error / 30 s timeout: retryable, but never more than MAX_ATTEMPTS.
        if (!retry || attempt >= MAX_ATTEMPTS) {
          throw new TacitoError({
            status: 0,
            code: "network",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          });
        }
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }

      const requestId = response.headers.get("x-request-id");
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (response.ok) {
        return parsed as T;
      }

      const body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      const message =
        typeof body.message === "string" && body.message ? body.message : `HTTP ${response.status}`;
      const fieldErrors =
        body.errors && typeof body.errors === "object" ? (body.errors as Record<string, unknown>) : null;
      const code = body.code !== undefined ? body.code : response.status;
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 409 && /please retry/i.test(message));
      const error = new TacitoError({
        status: response.status,
        code: code as string | number,
        message,
        fieldErrors,
        retryable,
        requestId,
      });
      if (!retryable || !retry || attempt >= MAX_ATTEMPTS) {
        throw error;
      }
      const retryAfterHeader = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : 500 * 2 ** (attempt - 1);
      if (waitMs > MAX_RETRY_WAIT_MS) {
        // Too long to wait inside this invocation: surface it; the cron retries next run.
        throw error;
      }
      await sleep(waitMs);
    }
    /* unreachable */
    throw new Error("[tacito] request loop exited unexpectedly");
  }

  // ------------------------------------------------------------------
  // Invoices
  // ------------------------------------------------------------------

  /** Create a DRAFT (no number, nothing reported to NAV). Key: `<reference>:create`. */
  createDraft(reference: string, payload: TacitoInvoicePayload): Promise<TacitoInvoice> {
    return this.request<TacitoInvoice>({
      method: "POST",
      path: "/invoices",
      body: payload,
      idempotencyKey: `${reference}:create`,
    });
  }

  /** Issue a draft (number + NAV report). Key: `<reference>:issue`. */
  issue(invoiceId: string, reference: string): Promise<TacitoInvoice> {
    return this.request<TacitoInvoice>({
      method: "POST",
      path: `/invoices/${encodeURIComponent(invoiceId)}/issue`,
      // The cron always sends the invoice e-mail itself after storing the
      // result, so issuing must never auto-send (whatever the account default).
      body: { send_email: false },
      idempotencyKey: `${reference}:issue`,
    });
  }

  /**
   * Create and issue in one call: the usual "paid ticket → invoice" step.
   * Both steps carry the reference keys, so a crash between them resumes
   * with exactly one invoice. Safe to retry with the same reference.
   */
  async createAndIssue(reference: string, payload: TacitoInvoicePayload): Promise<TacitoInvoice> {
    const draft = await this.createDraft(reference, payload);
    if (draft.state === "ISSUED") {
      return draft; // replayed create returned the issued state already
    }
    return this.issue(draft.id, reference);
  }

  /** E-mail the invoice to the buyer. Single attempt, no key, never retried. */
  sendInvoice(invoiceId: string): Promise<{ status: string; recipient_email: string; error: string | null }> {
    return this.request({ method: "POST", path: `/invoices/${encodeURIComponent(invoiceId)}/send`, retry: false });
  }

  /**
   * Storno step 1: create the cancelling draft. Key `<reference>:storno`.
   * Single attempt — the API may ignore the key here, so recovery is the
   * caller's `related` check, not an in-process retry.
   */
  stornoDraft(invoiceId: string, reference: string): Promise<TacitoInvoice> {
    return this.request<TacitoInvoice>({
      method: "POST",
      path: `/invoices/${encodeURIComponent(invoiceId)}/storno`,
      idempotencyKey: `${reference}:storno`,
      retry: false,
    });
  }

  /** Storno step 2: issue the returned draft. Key: `<reference>:storno-issue`. */
  issueStornoDraft(stornoDraftId: string, reference: string): Promise<TacitoInvoice> {
    return this.request<TacitoInvoice>({
      method: "POST",
      path: `/invoices/${encodeURIComponent(stornoDraftId)}/issue`,
      body: { send_email: false },
      idempotencyKey: `${reference}:storno-issue`,
    });
  }

  /** Fetch one invoice. */
  getInvoice(invoiceId: string): Promise<TacitoInvoice> {
    return this.request<TacitoInvoice>({ method: "GET", path: `/invoices/${encodeURIComponent(invoiceId)}` });
  }

  /** The tenant's invoice list (the legacy read; used to prove the issued count). */
  listInvoices(): Promise<TacitoInvoice[]> {
    return this.request<TacitoInvoice[]>({ method: "GET", path: "/invoices" });
  }

  /** Invoice detail incl. `related` (storno drafts and issued stornos of this invoice). */
  invoiceDetail(invoiceId: string): Promise<TacitoInvoiceDetail> {
    return this.request<TacitoInvoiceDetail>({ method: "GET", path: `/invoices/${encodeURIComponent(invoiceId)}/detail` });
  }

  /** Delete a tenant-owned draft (issued documents are immutable). */
  deleteDraft(invoiceId: string): Promise<void> {
    return this.request<void>({ method: "DELETE", path: `/invoices/${encodeURIComponent(invoiceId)}`, retry: false });
  }

  // ------------------------------------------------------------------
  // Events, settings, products
  // ------------------------------------------------------------------

  /** The invoice change feed: events after `after` (a previous page's next_cursor), oldest first. */
  events(options: { after?: string; limit?: number; type?: string } = {}): Promise<TacitoEventPage> {
    return this.request<TacitoEventPage>({ method: "GET", path: "/events", query: { after: options.after, limit: options.limit, type: options.type } });
  }

  /** The tenant's invoice series (`default_series_id` + the list with `next_number_preview`). */
  settingsSeries(): Promise<TacitoSeriesList> {
    return this.request<TacitoSeriesList>({ method: "GET", path: "/settings/series" });
  }

  /** Integration readiness of the calling key's tenant. */
  readiness(): Promise<TacitoReadiness> {
    return this.request<TacitoReadiness>({ method: "GET", path: "/readiness" });
  }

  /** The product catalog (line descriptions are autosaved as products by TACITo). */
  products(): Promise<{ items: TacitoProduct[]; q: string }> {
    return this.request<{ items: TacitoProduct[]; q: string }>({ method: "GET", path: "/products" });
  }
}

/** Client from `TACITO_API_KEY`, or null when the key is not configured. */
export function getTacitoClient(options: TacitoClientOptions = {}): TacitoClient | null {
  const key = options.apiKey ?? process.env.TACITO_API_KEY ?? "";
  if (!key) return null;
  return new TacitoClient({ ...options, apiKey: key });
}

// ---------------------------------------------------------------------------
// Invoice payload for one sold ticket
// ---------------------------------------------------------------------------

export type TacitoInvoiceLine = {
  description: string;
  quantity: string;
  unit: string;
  unit_price_gross: string;
  vat_rate: string;
};

export type TacitoBuyer = {
  name: string;
  country_code: string;
  postal_code: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  is_taxable_person: boolean;
  tax_number?: string;
};

export type TacitoInvoicePayload = {
  series_id: string;
  buyer: TacitoBuyer;
  lines: TacitoInvoiceLine[];
  payment_method: "BANK_TRANSFER" | "CASH" | "CARD" | "COD";
  currency: string;
  language: string;
  issue_date: string;
  performance_date?: string;
  due_date: string;
  invoice_note: string;
};

/** The stable, app-prefixed TACITo reference of one ticket's invoice. */
export function ticketReference(ticketId: string): string {
  return `rezkorut:ticket-${ticketId}`;
}

/** `YYYY-MM-DD` of an ISO timestamp in Europe/Budapest (fallback: today there). */
export function budapestDateString(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  const valid = iso ? !Number.isNaN(date.getTime()) : true;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(valid ? date : new Date());
}

/** Hungarian display form of a stored `YYYY-MM-DD` date: `2026. 12. 05.` */
function hungarianDate(dateIso: string | null): string {
  if (!dateIso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) return dateIso;
  return `${match[1]}. ${match[2]}. ${match[3]}.`;
}

/** The fixed service line every ticket invoice carries (owner decision: no per-concert products). */
export const TICKET_LINE_DESCRIPTION = "Előadó-művészeti tevékenység";

export type TicketInvoiceInput = {
  reference: string;
  payload: TacitoInvoicePayload;
};

/**
 * Builds the invoice request for one sold ticket: one ticket = one számla.
 *
 * - Private buyer when the order has no tax number (`is_taxable_person:false`);
 *   a company buyer (`tax_number` + `is_taxable_person:true`) only if the
 *   order somehow carries one — the purchase form never writes it (owner
 *   decision: private buyers only), so the private branch is the live path.
 * - `issue_date`/`due_date` = the payment date in Europe/Budapest;
 *   `performance_date` = the concert's date.
 * - `invoice_note`: one fact per line — concert, date + time, venue, ticket
 *   type, ticket code, order id (last 8 chars). No logistics text.
 */
export function buildTicketInvoice(
  order: Pick<RkOrder, "id" | "buyer_name" | "buyer_email" | "buyer_tax_number" | "address_country" | "address_postal" | "address_city" | "address_street" | "paid_at">,
  ticket: Pick<RkTicket, "id" | "price_huf" | "ticket_type_name" | "code">,
  concert: Pick<RkConcert, "title" | "event_date" | "event_time" | "venue" | "location"> | null,
): TicketInvoiceInput {
  const issueDate = budapestDateString(order.paid_at ?? null);

  const buyer: TacitoBuyer = {
    name: order.buyer_name ?? "",
    country_code: order.address_country || "HU",
    postal_code: order.address_postal,
    city: order.address_city,
    address: order.address_street,
    email: order.buyer_email,
    is_taxable_person: false,
  };
  if (order.buyer_tax_number) {
    buyer.tax_number = order.buyer_tax_number;
    buyer.is_taxable_person = true;
  }

  const noteLines = [
    concert?.title ? `Koncert: ${concert.title}` : "",
    concert?.event_date
      ? `Időpont: ${hungarianDate(concert.event_date)}${concert.event_time ? `, ${concert.event_time}` : ""}`
      : "",
    concert?.venue || concert?.location ? `Helyszín: ${concert.venue ?? concert.location}` : "",
    ticket.ticket_type_name ? `Jegytípus: ${ticket.ticket_type_name}` : "",
    `Jegy: ${ticket.code}`,
    `Rendelés: ${order.id.slice(-8)}`,
  ].filter(Boolean);

  const payload: TacitoInvoicePayload = {
    series_id: TACITO_SERIES_ID,
    buyer,
    lines: [
      {
        description: TICKET_LINE_DESCRIPTION,
        quantity: "1",
        unit: "alkalom",
        unit_price_gross: String(ticket.price_huf),
        vat_rate: "AAM",
      },
    ],
    payment_method: "CARD",
    currency: "HUF",
    language: "hu",
    issue_date: issueDate,
    due_date: issueDate,
    invoice_note: noteLines.join("\n"),
  };
  if (concert?.event_date) payload.performance_date = concert.event_date;

  return { reference: ticketReference(ticket.id), payload };
}
