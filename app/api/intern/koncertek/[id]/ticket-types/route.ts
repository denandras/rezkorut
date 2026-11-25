import { NextResponse, type NextRequest } from "next/server";
import { huDateToIso, listUpcomingConcerts } from "@/lib/concert-admin";
import {
  getConcert,
  getTicketDb,
  getTicketTypes,
  upsertConcert,
  upsertTicketTypes,
  type TicketTypeUpsert,
} from "@/lib/ticket-db";
import {
  deactivateTypePrice,
  getStripeClient,
  typeLookupKey,
  upsertTypePrice,
} from "@/lib/stripe-tickets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Intern ticket type API: replaces the full type list of a concert.
 *
 * For every PAID type in the payload a Stripe Product + Price is upserted
 * under the deterministic lookup key `rk:<concert_id>:<slug(name)>-<n>`
 * (unit_amount = price_huf * 100 fillér, currency huf, metadata
 * concert_id/ticket_type_id); the price of a type removed from the payload is
 * deactivated in Stripe and the row in rk_ticket_types is set active=false
 * (rows are never deleted).
 *
 * Card 11: a type with `price_huf = 0` is an ingyenes jegy — Stripe is never
 * touched for it (no product, no price; both columns stay null), and a
 * payload of only free types works without Stripe being configured at all.
 */

type RouteContext = { params: Promise<{ id: string }> };

function isIntern(req: NextRequest): boolean {
  return req.cookies.get("rezkorut-intern-auth")?.value === "1";
}

type TypeBody = {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  price_huf?: unknown;
  capacity?: unknown;
  sales_start?: unknown;
  sales_end?: unknown;
  active?: unknown;
  sort?: unknown;
};

type ValidatedType = {
  id?: string;
  name: string;
  kind: "standard" | "early_bird";
  price_huf: number;
  capacity: number | null;
  sales_start: string | null;
  sales_end: string | null;
  active: boolean;
  sort: number;
};

const MAX_TYPES = 20;

function validateTypes(raw: unknown): { types: ValidatedType[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "A jegytípusok listája nem lehet üres." };
  }
  if (raw.length > MAX_TYPES) {
    return { error: `Legfeljebb ${MAX_TYPES} jegytípus adható meg.` };
  }

  const out: ValidatedType[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { error: "Hibás jegytípus." };
    }
    const body = entry as TypeBody;

    if (typeof body.name !== "string") {
      return { error: "A jegytípus neve kötelező." };
    }
    const name = body.name.trim();
    if (name.length < 1 || name.length > 60) {
      return { error: "A jegytípus neve 1–60 karakter lehet." };
    }

    const kind = body.kind === undefined ? "standard" : body.kind;
    if (kind !== "standard" && kind !== "early_bird") {
      return { error: "A jegytípus fajtája csak teljes árú vagy elővételes lehet." };
    }

    const priceHuf = body.price_huf;
    // Card 11: 0 Ft = ingyenes jegy (no Stripe price is ever created for it);
    // a PAID type must be at least 200 Ft (Stripe's minimum charge).
    if (
      typeof priceHuf !== "number" ||
      !Number.isInteger(priceHuf) ||
      (priceHuf !== 0 && priceHuf < 200)
    ) {
      return { error: "A jegy ára 0 forint (ingyenes) vagy legalább 200 forint, egész szám." };
    }

    let capacity: number | null = null;
    if (body.capacity !== undefined && body.capacity !== null) {
      if (
        typeof body.capacity !== "number" ||
        !Number.isInteger(body.capacity) ||
        body.capacity < 1
      ) {
        return { error: "A férőhely 1 vagy nagyobb egész szám, vagy üresen hagyható." };
      }
      capacity = body.capacity;
    }

    let salesStart: string | null = null;
    let salesEnd: string | null = null;
    if (body.sales_start !== undefined && body.sales_start !== null && body.sales_start !== "") {
      if (typeof body.sales_start !== "string" || Number.isNaN(Date.parse(body.sales_start))) {
        return { error: "Értelmezhetetlen értékesítés-kezdet." };
      }
      salesStart = body.sales_start;
    }
    if (body.sales_end !== undefined && body.sales_end !== null && body.sales_end !== "") {
      if (typeof body.sales_end !== "string" || Number.isNaN(Date.parse(body.sales_end))) {
        return { error: "Értelmezhetetlen értékesítés-vég." };
      }
      salesEnd = body.sales_end;
    }
    if (salesStart && salesEnd && Date.parse(salesEnd) <= Date.parse(salesStart)) {
      return { error: "Az értékesítés vége a kezdete után kell legyen." };
    }

    const active = body.active === undefined ? true : body.active;
    if (typeof active !== "boolean") {
      return { error: "Az aktív jelző igaz vagy hamis lehet." };
    }

    const sort = body.sort === undefined ? 0 : body.sort;
    if (typeof sort !== "number" || !Number.isInteger(sort)) {
      return { error: "A sorrend egész szám." };
    }

    let id: string | undefined;
    if (body.id !== undefined && body.id !== null) {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return { error: "Hibás jegytípus-azonosító." };
      }
      id = body.id;
    }

    out.push({
      id,
      name,
      kind,
      price_huf: priceHuf,
      capacity,
      sales_start: salesStart,
      sales_end: salesEnd,
      active,
      sort,
    });
  }

  const earlyBirds = out.filter((type) => type.kind === "early_bird");
  if (earlyBirds.length > 1) {
    return { error: "Csak egy elővételes jegytípus lehet." };
  }

  return { types: out };
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isIntern(req)) {
    return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  }
  if (!getTicketDb()) {
    return NextResponse.json(
      { error: "A jegykezelés nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  const { id: concertId } = await ctx.params;

  let body: { types?: unknown };
  try {
    body = (await req.json()) as { types?: unknown };
  } catch {
    return NextResponse.json({ error: "Hibás kérés." }, { status: 400 });
  }

  const validated = validateTypes(body.types);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // A provided id must address an existing type of this concert. Local DB
  // check on purpose: validation must not depend on Stripe being configured.
  const typesBefore = await getTicketTypes(concertId);
  for (const type of validated.types) {
    if (type.id && !typesBefore.some((existing) => existing.id === type.id)) {
      return NextResponse.json(
        { error: "A megadott jegytípus nem tartozik ehhez a koncerthez." },
        { status: 400 },
      );
    }
  }

  // Payload validated. Card 11: a free-only payload never touches Stripe —
  // the client is only required when a PAID type is in the list (its price
  // object must be upserted). Removed PAID types are cleaned up best-effort.
  const hasPaidType = validated.types.some((type) => type.price_huf > 0);
  if (hasPaidType && !getStripeClient()) {
    return NextResponse.json(
      { error: "A Stripe nincs beállítva ezen a szerveren." },
      { status: 503 },
    );
  }

  try {
    // The rk_ticket_types FK requires the concert row. If the S3 line exists
    // but the mirror does not (id-less concert ticketed for the first time),
    // create the mirror row here with status draft.
    let concert = await getConcert(concertId);
    if (!concert) {
      const s3Concerts = await listUpcomingConcerts();
      const s3Concert = s3Concerts.find((entry) => entry.id === concertId);
      if (!s3Concert) {
        return NextResponse.json({ error: "Nincs ilyen koncert." }, { status: 404 });
      }
      const eventDate = huDateToIso(s3Concert.date);
      concert = await upsertConcert({
        concert_id: concertId,
        title: s3Concert.title,
        event_date: eventDate,
        event_time: s3Concert.time ?? null,
        location: s3Concert.location,
        venue: s3Concert.venue,
      });
    }

    const existing = await getTicketTypes(concertId);
    const existingById = new Map(existing.map((type) => [type.id, type]));
    const existingByLookup = new Map(
      existing
        .filter((type) => type.stripe_lookup_key)
        .map((type) => [type.stripe_lookup_key as string, type]),
    );

    const rows: TicketTypeUpsert[] = [];
    for (const [index, type] of validated.types.entries()) {
      const lookupKey = typeLookupKey(concertId, type.name, index + 1);
      const match = type.id
        ? existingById.get(type.id)
        : existingByLookup.get(lookupKey) ?? undefined;
      const ticketTypeId = match?.id ?? type.id ?? crypto.randomUUID();

      // Card 11: a 0 Ft type is an ingyenes jegy — it NEVER touches Stripe:
      // no product, no price object, `stripe_price_id` and
      // `stripe_lookup_key` stay null and that is valid for a free type.
      const isFree = type.price_huf === 0;
      const stripeResult = isFree
        ? null
        : await upsertTypePrice({
            concertId,
            concertTitle: concert.title,
            typeName: type.name,
            ticketTypeId,
            lookupKey,
            priceHuf: type.price_huf,
          });

      // Renamed type, or a type switched from paid to free: the old price
      // keeps living under the old lookup key — deactivate it now that the
      // row no longer references it.
      if (
        match &&
        match.stripe_price_id &&
        (isFree || (match.stripe_lookup_key && match.stripe_lookup_key !== lookupKey))
      ) {
        await deactivateTypePrice(match.stripe_price_id);
      }

      rows.push({
        id: ticketTypeId,
        concert_id: concertId,
        name: type.name,
        kind: type.kind,
        price_huf: type.price_huf,
        capacity: type.capacity,
        sales_start: type.sales_start,
        sales_end: type.sales_end,
        active: type.active,
        sort: type.sort,
        stripe_price_id: stripeResult ? stripeResult.priceId : null,
        stripe_lookup_key: stripeResult ? stripeResult.lookupKey : null,
      });
    }

    // DB sync first: the DB is the source of truth for what checkout may sell.
    const types = await upsertTicketTypes(concertId, rows);

    // Then best-effort Stripe cleanup for removed types (the next PUT retries
    // naturally, since the deactivated rows stay in the table).
    const keptIds = new Set(rows.map((row) => row.id));
    for (const removed of existing.filter((type) => !keptIds.has(type.id))) {
      if (removed.stripe_price_id) {
        try {
          await deactivateTypePrice(removed.stripe_price_id);
        } catch (err) {
          console.error(
            `[api/intern/koncertek] Stripe deactivation failed for price ${removed.stripe_price_id}:`,
            err,
          );
        }
      }
    }

    return NextResponse.json({ types });
  } catch (err) {
    console.error("[api/intern/koncertek/ticket-types] PUT failed:", err);
    return NextResponse.json(
      { error: "Nem sikerült menteni a jegytípusokat." },
      { status: 500 },
    );
  }
}
