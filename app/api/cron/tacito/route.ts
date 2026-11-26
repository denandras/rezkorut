import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized, runTacitoEvents, runTacitoInvoices } from "@/lib/tacito-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/tacito — the Hobby-plan entry point (vercel.json points its
 * single daily cron here): invoices first, then events, in one invocation.
 *
 * The account is on the Vercel Hobby plan, which allows cron expressions that
 * run at most once per day (more frequent expressions fail the deployment),
 * so the 5-minute /api/cron/tacito-invoices + /api/cron/tacito-events pair
 * is folded into this one route. Both separate routes still exist and work —
 * when the plan allows 5-minute crons, vercel.json can simply point its two
 * entries at those paths on an every-5-minutes schedule, without any code
 * change.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Érvénytelen cron hitelesítés." }, { status: 401 });
  }
  try {
    const invoices = await runTacitoInvoices();
    let events: Awaited<ReturnType<typeof runTacitoEvents>> | null = null;
    let eventsError: string | null = null;
    try {
      events = await runTacitoEvents();
    } catch (error) {
      // The invoice pass already succeeded; a failing events pass must not
      // mask that — report both halves separately.
      eventsError = error instanceof Error ? error.message : "Ismeretlen hiba.";
      console.error("[api/cron/tacito] events pass failed:", error);
    }
    return NextResponse.json({ ok: true, invoices, events, events_error: eventsError });
  } catch (error) {
    console.error("[api/cron/tacito] run failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Ismeretlen hiba." },
      { status: 503 },
    );
  }
}
