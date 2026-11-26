import { NextResponse, type NextRequest } from "next/server";

import { TACITO_SERIES_ID, formatTacitoError, getTacitoClient } from "@/lib/tacito";
import { getTacitoStatusData, getTicketDb, type TacitoStatusData } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TACITo health endpoint (card 04) — the "Számlázás (TACITo)" dashboard tile
 * reads this. NEVER throws and never answers 5xx: any failure is a
 * HTTP 200 `{ok:false, error}` so the tile can always render.
 *
 * The payload combines a live TACITo probe (`/readiness`, `/settings/series`)
 * with the DB counts; the computed payload is cached in module scope for 60
 * seconds so a busy dashboard does not hammer the TACITo API.
 *
 * `series` always reports the series actually used for invoicing — the
 * hard-coded ELOADO id — and `series_mismatch` flags when /settings/series
 * no longer contains that id or the tenant default changed away from it.
 */

const CACHE_TTL_MS = 60_000;

type StatusPayload =
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
      /** True when the invoicing series vanished from /settings/series or lost its default. */
      series_mismatch: boolean;
      auto_send_invoice_email: boolean;
      counts: TacitoStatusData["counts"];
      last_error: TacitoStatusData["last_error"];
    }
  | { ok: false; checked_at: string; error: string };

let cache: { at: number; payload: StatusPayload } | null = null;

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

async function compute(): Promise<StatusPayload> {
  const checkedAt = new Date().toISOString();

  if (!getTicketDb()) {
    return { ok: false, checked_at: checkedAt, error: "A jegykezelés nincs beállítva." };
  }
  const tacito = getTacitoClient();
  if (!tacito) {
    return { ok: false, checked_at: checkedAt, error: "A TACITO_API_KEY nincs beállítva." };
  }

  try {
    // Live reads first; a TACITo outage degrades the whole tile to ok:false.
    const [readiness, seriesList, data] = await Promise.all([
      tacito.readiness(),
      tacito.settingsSeries(),
      getTacitoStatusData(),
    ]);

    const series = (seriesList.series ?? []).find((item) => item.id === TACITO_SERIES_ID) ?? null;
    const seriesMismatch = !series || seriesList.default_series_id !== TACITO_SERIES_ID;

    return {
      ok: true,
      checked_at: checkedAt,
      readiness: {
        ready: readiness.ready === true,
        livemode: readiness.livemode === true,
        nav_environment: readiness.nav?.environment ?? null,
        production_allowed: readiness.nav?.production_allowed === true,
        missing: (readiness.missing ?? []).map((item) => ({ step: item.step, url: item.url })),
      },
      series: {
        id: TACITO_SERIES_ID,
        name: series?.name ?? null,
        prefix: series?.prefix ?? null,
        next_number_preview: series?.next_number_preview ?? null,
      },
      series_mismatch: seriesMismatch,
      auto_send_invoice_email: readiness.auto_send_invoice_email === true,
      counts: data.counts,
      last_error: data.last_error,
    };
  } catch (error) {
    console.error("[api/intern/tacito/status] computation failed:", formatTacitoError(error));
    return { ok: false, checked_at: checkedAt, error: `TACITo állapot: ${formatTacitoError(error)}`.slice(0, 200) };
  }
}

export async function GET(req: NextRequest) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }

  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    cache = { at: Date.now(), payload: await compute() };
  }
  return NextResponse.json(cache.payload);
}
