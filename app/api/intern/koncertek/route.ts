import { NextResponse, type NextRequest } from "next/server";
import {
  createConcert,
  deriveConcertId,
  huDateToIso,
  listUpcomingConcerts,
  normalizeDateInput,
  type Concert,
} from "@/lib/concert-admin";
import { getTicketDb, listConcertsWithSales, upsertConcert } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Intern concert API (list + create).
 *
 * GET joins the live S3 upcoming-concerts file with the rk_concerts Supabase
 * mirror + ticket types + sold/capacity/revenue aggregates. A concert with no
 * rk_concerts row yet comes back with `ticketing: null` and the id that would
 * be assigned to it on first write (derived, read-only).
 *
 * POST creates the concert in the live S3 file (lib/concert-admin) and mirrors
 * it into rk_concerts with status `draft`.
 */

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

/** Read-only id derivation identical to the write-path migration (assignMissingIds). */
function withDerivedIds(concerts: Concert[]): (Concert & { id?: string })[] {
  const existing = new Set(concerts.flatMap((concert) => (concert.id ? [concert.id] : [])));
  return concerts.map((concert) => {
    if (concert.id) return concert;
    try {
      const id = deriveConcertId(concert, existing);
      existing.add(id);
      return { ...concert, id };
    } catch (err) {
      console.error("[api/intern/koncertek] cannot derive id:", err);
      return concert;
    }
  });
}

export async function GET(req: NextRequest) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  try {
    const s3Concerts = await listUpcomingConcerts();
    const sales = await listConcertsWithSales();
    const salesByConcertId = new Map(sales.map((entry) => [entry.concert.concert_id, entry]));

    const concerts = withDerivedIds(s3Concerts).map((concert) => {
      const entry = concert.id ? salesByConcertId.get(concert.id) : undefined;
      return {
        ...concert,
        ticketing: entry
          ? {
              status: entry.concert.status,
              types: entry.types,
              sold: entry.sold,
              capacity: entry.capacity,
              revenue_huf: entry.revenue_huf,
              orders_count: entry.orders_count,
            }
          : null,
      };
    });

    return NextResponse.json({ concerts });
  } catch (err) {
    console.error("[api/intern/koncertek] GET failed:", err);
    return NextResponse.json({ error: "Nem sikerült betölteni a koncerteket." }, { status: 500 });
  }
}

type PostBody = {
  date?: unknown;
  time?: unknown;
  location?: unknown;
  venue?: unknown;
  title?: unknown;
  program?: unknown;
  href?: unknown;
  href_label?: unknown;
};

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

function validateProgram(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 30) return null;
  const out: string[] = [];
  for (const item of value) {
    const trimmed = asTrimmedString(item, 200);
    if (!trimmed) return null;
    out.push(trimmed);
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }

  const title = asTrimmedString(body.title, 200);
  if (!title) {
    return NextResponse.json({ error: "A cím megadása kötelező (1–200 karakter)." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? normalizeDateInput(body.date) : null;
  if (!date) {
    return NextResponse.json(
      { error: "Értelmezhetetlen dátum (példa: 2026. december 12. vagy 2026-12-12)." },
      { status: 400 },
    );
  }

  const location = typeof body.location === "string" ? body.location.trim() : "";
  const venue = typeof body.venue === "string" ? body.venue.trim() : "";
  if (!location && !venue) {
    return NextResponse.json(
      { error: "Legalább a helyszín vagy a terem megadása szükséges." },
      { status: 400 },
    );
  }

  let time: string | undefined;
  if (typeof body.time === "string" && body.time.trim() !== "") {
    const trimmed = asTrimmedString(body.time, 30);
    if (!trimmed) {
      return NextResponse.json({ error: "Értelmezhetetlen időpont." }, { status: 400 });
    }
    time = trimmed;
  }

  let program: string[] | undefined;
  if (Array.isArray(body.program)) {
    const validated = validateProgram(body.program);
    if (!validated) {
      return NextResponse.json({ error: "Hibás műsorlista." }, { status: 400 });
    }
    // An empty list is "no program": the file format has no empty-program
    // state (serializeConcert drops it), so store undefined, not [].
    program = validated.length > 0 ? validated : undefined;
  }

  const href =
    body.href === undefined || body.href === null || body.href === ""
      ? undefined
      : asTrimmedString(body.href, 500);
  if (href === null) {
    return NextResponse.json({ error: "Hibás jegyinfo link." }, { status: 400 });
  }
  const hrefLabel =
    body.href_label === undefined || body.href_label === null || body.href_label === ""
      ? undefined
      : asTrimmedString(body.href_label, 60);
  if (hrefLabel === null) {
    return NextResponse.json({ error: "Hibás jegyinfo felirat." }, { status: 400 });
  }

  try {
    // 1. S3: create the concert line (id derived + assigned here).
    const created = await createConcert({
      date,
      time,
      location,
      venue,
      title,
      program,
      link: href ? { href, label: hrefLabel ?? "Jegyinfo" } : undefined,
    });
    if (!created.id) {
      throw new Error("createConcert returned no id");
    }

    // 2. Supabase mirror, status defaults to `draft`.
    const eventDate = huDateToIso(created.date);
    if (!eventDate) {
      throw new Error(`created concert has unparsable date: ${created.date}`);
    }
    const mirrored = await upsertConcert({
      concert_id: created.id,
      title: created.title,
      event_date: eventDate,
      event_time: created.time ?? null,
      location: created.location,
      venue: created.venue,
    });

    return NextResponse.json({ concert: created, ticketing: { status: mirrored.status } });
  } catch (err) {
    console.error("[api/intern/koncertek] POST failed:", err);
    return NextResponse.json({ error: "Nem sikerült létrehozni a koncertet." }, { status: 500 });
  }
}
