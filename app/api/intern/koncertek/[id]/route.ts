import { NextResponse, type NextRequest } from "next/server";
import {
  deleteConcert,
  deriveConcertId,
  huDateToIso,
  listUpcomingConcerts,
  normalizeDateInput,
  updateConcert,
  type Concert,
  type ConcertPatch,
} from "@/lib/concert-admin";
import { getConcert, getTicketDb, listOrders, setConcertStatus, upsertConcert } from "@/lib/ticket-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Intern concert API (update + delete).
 *
 * PATCH rewrites the concert's S3 line and refreshes the rk_concerts mirror.
 * DELETE removes the S3 line and closes the rk_concerts row — rows are never
 * deleted, because orders and sold counts reference them.
 */

type RouteContext = { params: Promise<{ id: string }> };

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

async function findS3Concert(
  concertId: string,
): Promise<(Concert & { id?: string }) | null> {
  const concerts = withDerivedIds(await listUpcomingConcerts());
  return concerts.find((concert) => concert.id === concertId) ?? null;
}

type PatchBody = {
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

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }

  const provided = ["date", "time", "location", "venue", "title", "program", "href", "href_label"];
  if (!provided.some((field) => body[field as keyof PatchBody] !== undefined)) {
    return NextResponse.json({ error: "Nincs módosítandó mező." }, { status: 400 });
  }

  try {
    const current = await findS3Concert(id);
    if (!current) {
      return NextResponse.json({ error: "Nincs ilyen koncert." }, { status: 404 });
    }

    const patch: ConcertPatch = {};

    if (body.title !== undefined) {
      const title = asTrimmedString(body.title, 200);
      if (!title) {
        return NextResponse.json({ error: "A cím 1–200 karakter lehet." }, { status: 400 });
      }
      patch.title = title;
    }

    if (body.date !== undefined) {
      const date = typeof body.date === "string" ? normalizeDateInput(body.date) : null;
      if (!date) {
        return NextResponse.json(
          { error: "Értelmezhetetlen dátum (példa: 2026. december 12. vagy 2026-12-12)." },
          { status: 400 },
        );
      }
      patch.date = date;
    }

    if (body.time !== undefined) {
      // Empty string clears the time slot.
      if (body.time === "") {
        patch.time = undefined;
      } else {
        const time = asTrimmedString(body.time, 30);
        if (!time) {
          return NextResponse.json({ error: "Értelmezhetetlen időpont." }, { status: 400 });
        }
        patch.time = time;
      }
    }

    if (body.location !== undefined) {
      if (typeof body.location !== "string" || body.location.trim().length > 200) {
        return NextResponse.json({ error: "Hibás helyszín." }, { status: 400 });
      }
      patch.location = body.location.trim();
    }

    if (body.venue !== undefined) {
      if (typeof body.venue !== "string" || body.venue.trim().length > 200) {
        return NextResponse.json({ error: "Hibás terem." }, { status: 400 });
      }
      patch.venue = body.venue.trim();
    }

    if (patch.date && !patch.venue && !patch.location) {
      const venue = patch.venue ?? current.venue ?? "";
      const location = patch.location ?? current.location ?? "";
      if (!venue && !location) {
        return NextResponse.json(
          { error: "Legalább a helyszín vagy a terem megadása szükséges." },
          { status: 400 },
        );
      }
    }

    if (body.program !== undefined) {
      if (body.program === null || (Array.isArray(body.program) && body.program.length === 0)) {
        patch.program = undefined; // clear the program field
      } else if (Array.isArray(body.program)) {
        if (body.program.length > 30) {
          return NextResponse.json({ error: "Túl hosszú műsorlista." }, { status: 400 });
        }
        const items: string[] = [];
        for (const item of body.program) {
          const trimmed = asTrimmedString(item, 200);
          if (!trimmed) {
            return NextResponse.json({ error: "Hibás műsorlista." }, { status: 400 });
          }
          items.push(trimmed);
        }
        patch.program = items;
      } else {
        return NextResponse.json({ error: "Hibás műsorlista." }, { status: 400 });
      }
    }

    if (body.href !== undefined) {
      if (body.href === "" || body.href === null) {
        patch.link = undefined; // clear the link
      } else {
        const href = asTrimmedString(body.href, 500);
        if (!href) {
          return NextResponse.json({ error: "Hibás jegyinfo link." }, { status: 400 });
        }
        const label =
          (typeof body.href_label === "string" && body.href_label.trim()) ||
          current.link?.label ||
          "Jegyinfo";
        patch.link = { href, label };
      }
    } else if (typeof body.href_label === "string" && body.href_label.trim() && current.link) {
      patch.link = { href: current.link.href, label: body.href_label.trim() };
    }

    const updated = await updateConcert(id, patch);

    // Refresh the Supabase mirror (inserts the row if it did not exist yet,
    // keeps the existing status on conflict).
    const eventDate = huDateToIso(updated.date);
    if (!eventDate) {
      throw new Error(`updated concert has unparsable date: ${updated.date}`);
    }
    const mirrored = await upsertConcert({
      concert_id: updated.id ?? id,
      title: updated.title,
      event_date: eventDate,
      event_time: updated.time ?? null,
      location: updated.location,
      venue: updated.venue,
    });

    return NextResponse.json({ concert: updated, ticketing: { status: mirrored.status } });
  } catch (err) {
    console.error("[api/intern/koncertek] PATCH failed:", err);
    return NextResponse.json({ error: "Nem sikerült módosítani a koncertet." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  const { id } = await ctx.params;

  try {
    const [s3Concert, dbConcert] = await Promise.all([findS3Concert(id), getConcert(id)]);
    if (!s3Concert && !dbConcert) {
      return NextResponse.json({ error: "Nincs ilyen koncert." }, { status: 404 });
    }

    if (s3Concert) {
      await deleteConcert(id);
    }

    // Never delete the DB row: orders and sold counts reference it. Close it.
    const closed = dbConcert ? await setConcertStatus(id, "closed") : null;
    const orders = await listOrders(id);

    return NextResponse.json({
      ok: true,
      s3_removed: Boolean(s3Concert),
      concert: closed,
      orders_count: orders.length,
    });
  } catch (err) {
    console.error("[api/intern/koncertek] DELETE failed:", err);
    return NextResponse.json({ error: "Nem sikerült törölni a koncertet." }, { status: 500 });
  }
}
