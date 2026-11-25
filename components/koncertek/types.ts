/**
 * Client-safe DTOs of the intern ticketing API (card 02) + deterministic
 * Hungarian formatting helpers. Never imports server-only modules — these
 * mirror the JSON the API routes answer, nothing else.
 */

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ApiTicketType = {
  id: string;
  concert_id: string;
  name: string;
  kind: "standard" | "early_bird";
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

export type TicketingInfo = {
  status: "draft" | "on_sale" | "sold_out" | "closed";
  types: ApiTicketType[];
  sold: number;
  capacity: number | null;
  revenue_huf: number;
  orders_count: number;
};

export type ApiConcert = {
  id?: string;
  date: string;
  time?: string;
  location: string;
  venue: string;
  title: string;
  program?: string[];
  link?: { label: string; href: string };
  ticketing: TicketingInfo | null;
};

export type ApiOrder = {
  id: string;
  concert_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  amount_huf: number;
  currency: string;
  status: "pending" | "paid" | "refunded" | "expired" | "failed";
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
  tickets: ApiTicket[];
};

export type ApiTicket = {
  id: string;
  order_id: string;
  concert_id: string;
  ticket_type_name: string | null;
  price_huf: number;
  code: string;
  status: "valid" | "used" | "void";
  used_at: string | null;
  tacito_invoice_number: string | null;
  tacito_nav_outcome: string | null;
  tacito_error: string | null;
};

export type TacitoStatus =
  | {
      ok: true;
      checked_at: string;
      readiness: {
        ready: boolean;
        livemode: boolean;
        nav_environment: string | null;
        production_allowed: boolean;
        missing: { step: string; url?: string }[];
      };
      series: {
        id: string;
        name: string | null;
        prefix: string | null;
        next_number_preview: string | null;
      };
      series_mismatch: boolean;
      auto_send_invoice_email: boolean;
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
    }
  | { ok: false; checked_at: string; error: string };

export type CheckinResponse = {
  result: "valid" | "used" | "void" | "wrong_concert" | "unknown";
  ticket?: {
    code: string;
    ticket_type_name: string | null;
    buyer_name: string | null;
    used_at: string | null;
  } | null;
  counts: { used: number; sold: number };
};

// ---------------------------------------------------------------------------
// Formatting (deterministic — identical on server and client)
// ---------------------------------------------------------------------------

/** HU thousands grouping with a no-break space: 4 000. Never toLocaleString. */
export function formatHuf(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

const HU_MONTH_NAMES = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

const HU_MONTH_BY_NAME: Record<string, string> = Object.fromEntries(
  HU_MONTH_NAMES.map((name, index) => [name, String(index + 1).padStart(2, "0")]),
);

/**
 * Parses the file's Hungarian date (`2026. november 27.`) into `2026-11-27`,
 * or accepts a sortable ISO date directly. Returns null for anything else.
 * Client-safe copy of lib/concert-admin's huDateToIso (that module pulls in
 * the AWS SDK and must never be imported from a client component).
 */
export function huDateToIso(hu: string): string | null {
  const trimmed = hu.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{4})\s*\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})\s*\.\s*$/i);
  if (!match) return null;
  const month = HU_MONTH_BY_NAME[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[1]}-${month}-${match[3].padStart(2, "0")}`;
}

/** `2026-11-27` → `2026. november 27.` (null for malformed input). */
export function isoToHuDate(iso: string | null): string | null {
  if (!iso) return null;
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}. ${HU_MONTH_NAMES[month - 1]} ${day}.`;
}

/** ISO timestamp → `2026.11.25. 19:03` in the Europe/Budapest timezone. */
export function formatTimestampHu(iso: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  const [date, time] = parts.split(" ");
  if (!date || !time) return iso;
  const dotted = date.replaceAll("-", ".");
  return `${dotted}. ${time}`;
}

/** Today's `YYYY-MM-DD` in the Europe/Budapest timezone. */
export function todayIsoInBudapest(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
}
