import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized, runTacitoEvents } from "@/lib/tacito-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/tacito-events — keep NAV status in sync.
 * Authorized with `Authorization: Bearer $CRON_SECRET`. Polls the TACITo
 * change feed after the stored cursor and mirrors each event's NAV outcome
 * onto `rk_tickets.tacito_nav_outcome` by invoice id.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Érvénytelen cron hitelesítés." }, { status: 401 });
  }
  try {
    const result = await runTacitoEvents();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[api/cron/tacito-events] run failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Ismeretlen hiba." },
      { status: 503 },
    );
  }
}
