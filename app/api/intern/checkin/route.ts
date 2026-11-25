import { NextResponse, type NextRequest } from "next/server";

import { isValidCode } from "@/lib/ticket-code";
import { getTicketDb } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Door check-in (card 06, spec in the brief's internal API list):
 * POST /api/intern/checkin `{concert_id, code}` →
 * `{result:"valid"|"used"|"void"|"wrong_concert"|"unknown", ticket?, counts}`.
 *
 * The code is normalized the same way the check-in screen normalizes it
 * (trim, uppercase, strip spaces and dashes). A `valid` scan marks the ticket
 * `used` with `used_at` — conditionally (`status = 'valid'`), so two door
 * scanners racing on the same code produce one `valid` and one `used`.
 *
 * `counts` carries the live door counter: used / total sold tickets of the
 * concert (sold = valid + used; void tickets were refunded). The route does
 * not require an rk_concerts row for the concert: tickets only exist for
 * concerts with sold orders, so the counts key off rk_tickets alone.
 */

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

type TicketRow = {
  id: string;
  order_id: string;
  concert_id: string;
  ticket_type_name: string | null;
  code: string;
  status: "valid" | "used" | "void";
  used_at: string | null;
};

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

async function doorCounts(client: NonNullable<ReturnType<typeof getTicketDb>>, concertId: string) {
  const { data, error } = await client
    .from("rk_tickets")
    .select("status")
    .eq("concert_id", concertId);
  if (error) throw new Error(`[checkin] rk_tickets counts failed: ${error.message}`);
  const rows = (data ?? []) as { status: string }[];
  return {
    used: rows.filter((row) => row.status === "used").length,
    sold: rows.filter((row) => row.status !== "void").length,
  };
}

export async function POST(req: NextRequest) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  const client = getTicketDb();
  if (!client) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  let body: { concert_id?: unknown; code?: unknown };
  try {
    body = (await req.json()) as { concert_id?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }

  const concertId = typeof body.concert_id === "string" ? body.concert_id.trim() : "";
  if (!concertId) {
    return NextResponse.json({ error: "Hiányzó koncert-azonosító." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
  if (!isValidCode(code)) {
    // Not even shaped like a ticket code → unknown (with the door counter so
    // the screen state stays consistent).
    try {
      return NextResponse.json({ result: "unknown", ticket: null, counts: await doorCounts(client, concertId) });
    } catch (err) {
      console.error("[api/intern/checkin] counts failed:", err);
      return NextResponse.json({ result: "unknown", ticket: null, counts: { used: 0, sold: 0 } });
    }
  }

/** Europe/Budapest offset (minutes) for a given instant, DST-safe. */
function budapestOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    timeZoneName: "longOffset",
  });
  const part = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 60;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Concert start as a UTC instant from the stored HU date + time. */
function concertStart(eventDate: string, eventTime: string | null): Date | null {
  if (!eventDate) return null;
  const time = (eventTime ?? "19:00").trim() || "19:00";
  const naive = new Date(`${eventDate}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const offset = budapestOffsetMinutes(naive);
  return new Date(naive.getTime() - offset * 60_000);
}

/** Entry opens this many minutes before the start and closes that many after. */
const CHECKIN_OPENS_BEFORE_MIN = 4 * 60;
const CHECKIN_CLOSES_AFTER_MIN = 6 * 60;

  try {
    const { data: found, error: findError } = await client
      .from("rk_tickets")
      .select("id,order_id,concert_id,ticket_type_name,code,status,used_at")
      .eq("code", code)
      .maybeSingle();
    if (findError) throw new Error(`[checkin] rk_tickets lookup failed: ${findError.message}`);

    const ticket = (found as TicketRow | null) ?? null;
    if (!ticket || ticket.concert_id !== concertId) {
      const result = ticket ? "wrong_concert" : "unknown";
      return NextResponse.json({
        result,
        ticket: ticket ? { code: ticket.code } : null,
        counts: await doorCounts(client, concertId),
      });
    }

    // Entry window: 4 h before the concert starts, closed 6 h after the start.
    // Before/after that a scan is refused with the reason, so nobody is marked
    // as entered weeks early by an accidental click.
    const { data: concertRow, error: concertError } = await client
      .from("rk_concerts")
      .select("event_date,event_time,status")
      .eq("concert_id", concertId)
      .maybeSingle();
    if (concertError) throw new Error(`[checkin] rk_concerts lookup failed: ${concertError.message}`);
    const start = concertRow?.event_date
      ? concertStart(String(concertRow.event_date), (concertRow.event_time as string | null) ?? null)
      : null;
    if (start) {
      const now = Date.now();
      const opensAt = start.getTime() - CHECKIN_OPENS_BEFORE_MIN * 60_000;
      const closesAt = start.getTime() + CHECKIN_CLOSES_AFTER_MIN * 60_000;
      if (now < opensAt || now > closesAt) {
        return NextResponse.json({
          result: "closed",
          message: "A beléptetés a koncert előtt 4 órával nyílik meg.",
          opens_at: new Date(opensAt).toISOString(),
          closes_at: new Date(closesAt).toISOString(),
          ticket: null,
          counts: await doorCounts(client, concertId),
        });
      }
    }

    if (ticket.status === "void") {
      return NextResponse.json({
        result: "void",
        ticket: { code: ticket.code },
        counts: await doorCounts(client, concertId),
      });
    }

    if (ticket.status === "used") {
      return NextResponse.json({
        result: "used",
        ticket: {
          code: ticket.code,
          ticket_type_name: ticket.ticket_type_name,
          used_at: ticket.used_at,
        },
        counts: await doorCounts(client, concertId),
      });
    }

    // valid → mark used, but only if still valid (two scanners may race).
    const { data: updated, error: updateError } = await client
      .from("rk_tickets")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", ticket.id)
      .eq("status", "valid")
      .select("id,used_at")
      .maybeSingle();
    if (updateError) throw new Error(`[checkin] rk_tickets update failed: ${updateError.message}`);

    if (!updated) {
      // Lost the race: the other scan marked it used first.
      const { data: reread, error: rereadError } = await client
        .from("rk_tickets")
        .select("code,status,used_at,ticket_type_name")
        .eq("id", ticket.id)
        .maybeSingle();
      if (rereadError) throw new Error(`[checkin] rk_tickets re-read failed: ${rereadError.message}`);
      const fresh = (reread as { code: string; status: string; used_at: string | null; ticket_type_name: string | null } | null) ?? null;
      return NextResponse.json({
        result: fresh?.status === "used" ? "used" : "unknown",
        ticket: fresh
          ? { code: fresh.code, ticket_type_name: fresh.ticket_type_name, used_at: fresh.used_at }
          : null,
        counts: await doorCounts(client, concertId),
      });
    }

    // Buyer name for the result panel.
    const { data: order, error: orderError } = await client
      .from("rk_orders")
      .select("buyer_name")
      .eq("id", ticket.order_id)
      .maybeSingle();
    if (orderError) throw new Error(`[checkin] rk_orders lookup failed: ${orderError.message}`);

    return NextResponse.json({
      result: "valid",
      ticket: {
        code: ticket.code,
        ticket_type_name: ticket.ticket_type_name,
        buyer_name: (order as { buyer_name: string | null } | null)?.buyer_name ?? null,
        used_at: updated.used_at,
      },
      counts: await doorCounts(client, concertId),
    });
  } catch (err) {
    console.error("[api/intern/checkin] POST failed:", err);
    return NextResponse.json({ error: "Nem sikerült a beolvasás." }, { status: 500 });
  }
}
