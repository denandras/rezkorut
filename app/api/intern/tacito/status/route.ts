import { NextResponse, type NextRequest } from "next/server";
import { getTacitoStatusData, getTicketDb, type TacitoStatusData } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TACITo health tile endpoint (DB half; card 04 adds the live TACITo API
 * probe). NEVER throws and never answers 5xx: any failure is a
 * 200 `{ok:false, error}` so the dashboard tile can always render. The
 * computed payload is cached in module scope for 60 seconds.
 */

const CACHE_TTL_MS = 60_000;

type StatusPayload =
  | { ok: true; checked_at: string; counts: TacitoStatusData["counts"]; last_errors: TacitoStatusData["last_errors"] }
  | { ok: false; checked_at: string; error: string };

let cache: { at: number; payload: StatusPayload } | null = null;

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

async function compute(): Promise<StatusPayload> {
  if (!getTicketDb()) {
    return { ok: false, checked_at: new Date().toISOString(), error: "A jegykezelés nincs beállítva." };
  }
  try {
    const data = await getTacitoStatusData();
    return {
      ok: true,
      checked_at: new Date().toISOString(),
      counts: data.counts,
      last_errors: data.last_errors,
    };
  } catch (err) {
    console.error("[api/intern/tacito/status] computation failed:", err);
    return { ok: false, checked_at: new Date().toISOString(), error: "Nem sikerült lekérni a számlázási állapotot." };
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
