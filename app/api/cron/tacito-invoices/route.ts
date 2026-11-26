import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized, runTacitoInvoices } from "@/lib/tacito-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/tacito-invoices — issue one számla per sold ticket.
 * Authorized with `Authorization: Bearer $CRON_SECRET` (Vercel cron sets it
 * automatically once the project has crons; manual curl works the same way).
 * Idempotent: safe to call every 5 minutes on Pro, or by hand any time.
 *
 * `?draft=1` (card 12): dry run — the payloads are created as TACITo drafts
 * (never issued, deleted again, nothing stored) and the per-ticket allocated
 * gross prices are reported in `draft_details`. The cron never sets it.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Érvénytelen cron hitelesítés." }, { status: 401 });
  }
  const draft = req.nextUrl.searchParams.get("draft") === "1";
  try {
    const result = await runTacitoInvoices({ draft });
    return NextResponse.json({ ok: true, draft, ...result });
  } catch (error) {
    console.error("[api/cron/tacito-invoices] run failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Ismeretlen hiba." },
      { status: 503 },
    );
  }
}
