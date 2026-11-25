// Verification harness for card 05 (public purchase pages + concert card CTA).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/public-pages-check.mjs setup   # throwaway concert (S3 + DB, on_sale, 2 types)
//   node scripts/public-pages-check.mjs check   # assertions a, b, d (fetch + rendered HTML)
//   node scripts/public-pages-check.mjs cleanup # removes everything setup created (prints it)
//
// The fixture mirrors the card 02 intern pipeline through the SAME lib
// functions (lib/concert-admin.ts + lib/ticket-db.ts) but never touches
// Stripe: the two throwaway types get no stripe_price_id, and no checkout
// session is ever created (STRIPE_SECRET_KEY is live on this account — no
// session, charge or price may be created here). The card 06 dashboard and
// the checkout/webhook are covered by their own harnesses.
//
// Proofs (per the card):
//   a) GET /jegyek/<id> renders "Jegyvásárlás"/"Elfogadom" (match count > 0)
//   b) the two type names + prices from the DB appear in the rendered page
//   d) GET /jegyek/koszonjuk?session_id=<unknown> → HTTP 200, graceful HU text
//   d2) success page states with DB-inserted demo orders (removed in cleanup):
//       a fulfilled order renders the ticket codes + the buyer's own name only,
//       a pending order renders the "A jegyek e-mailben érkeznek" state and
//       no codes.
// (c: the /esemenyek card CTA + anchor counting, and (e): screenshots +
//      geometry are asserted with the browser tool, see the card completion.)

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Environment (same .env.local the dev server reads)
// ---------------------------------------------------------------------------

function parseDotEnv() {
  const out = {};
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // .env.local missing — fall back to process.env below
  }
  return out;
}

const fileEnv = parseDotEnv();
const env = (name) => process.env[name] || fileEnv[name] || "";

const BASE_URL = process.env.TICKET_API_BASE_URL || "http://localhost:3001";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
assert.ok(env("S4_ENDPOINT"), "S4_ENDPOINT must be in .env.local");
assert.ok(env("S4_UPCOMING_PREFIX"), "S4_UPCOMING_PREFIX must be in .env.local");

// Seed process.env for the imported server libs (they read process.env).
for (const key of [
  "S4_ENDPOINT",
  "S4_ACCESS_KEY_ID",
  "S4_SECRET_ACCESS_KEY",
  "S4_REGION",
  "S4_BUCKET",
  "S4_PREFIX",
  "S4_UPCOMING_PREFIX",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (fileEnv[key] && !process.env[key]) process.env[key] = fileEnv[key];
}

// ---------------------------------------------------------------------------
// "@" alias hook + server lib imports (same style as the card 01–04 harnesses)
// ---------------------------------------------------------------------------

const REPO_ROOT_URL = new URL("../", import.meta.url).href;
const aliasHookSource = `
  const root = ${JSON.stringify(REPO_ROOT_URL)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      let rest = specifier.slice(2);
      if (!rest.split("/").pop().includes(".")) rest += ".ts";
      return next(new URL(rest, root).href, context);
    }
    return next(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(aliasHookSource)}`);

const admin = await import("../lib/concert-admin.ts");
const ticketDb = await import("../lib/ticket-db.ts");
const { serializeConcert } = await import("../lib/upcoming-concerts.ts");

// ---------------------------------------------------------------------------
// Fixture state (scratch file so setup and cleanup are separate invocations)
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";

const FIXTURE_FILE =
  process.env.PUBLIC_PAGES_FIXTURE_FILE ||
  join(homedir(), ".hermes/profiles/coder/cache/scratch/public-pages-fixture.json");

const FIXTURE = {
  date: "2026. december 20.",
  isoDate: "2026-12-20",
  time: "19:00",
  location: "Budapest",
  venue: "Teszt Terem",
  title: "Teszt koncert (ellenőrzés)",
  program: ["Első próbadarab", "Második próbadarab"],
  types: [
    { name: "Teljes árú jegy", kind: "standard", price_huf: 4000, capacity: 50 },
    { name: "Early bird jegy", kind: "early_bird", price_huf: 3000, capacity: 20 },
  ],
};

async function listFixture() {
  const before = await admin.listUpcomingConcerts();
  return before.filter((concert) => concert.venue === FIXTURE.venue && concert.title === FIXTURE.title);
}

async function loadFixture() {
  const raw = JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
  assert.ok(raw.concertId, "fixture file carries no concertId — run setup first");
  return raw;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

async function setup() {
  const stray = await listFixture();
  assert.deepEqual(
    stray,
    [],
    `the live file already contains ${stray.length} leftover fixture line(s) — run cleanup first`,
  );

  const before = (await admin.listUpcomingConcerts()).length;

  // S3 line (same code path the intern API uses)
  const created = await admin.createConcert({
    date: FIXTURE.date,
    time: FIXTURE.time,
    location: FIXTURE.location,
    venue: FIXTURE.venue,
    title: FIXTURE.title,
    program: FIXTURE.program,
  });
  const after = (await admin.listUpcomingConcerts()).length;
  assert.equal(after, before + 1, "the S3 line was not created");
  console.log(`S3 upcoming line created: id=${created.id} (lines ${before} → ${after})`);
  console.log(`  ${admin.serializeConcert(created)}`);

  // DB mirror + two ticket types (NO stripe_price_id: no Stripe object is created)
  await ticketDb.upsertConcert({
    concert_id: created.id,
    title: FIXTURE.title,
    event_date: FIXTURE.isoDate,
    event_time: FIXTURE.time,
    location: FIXTURE.location,
    venue: FIXTURE.venue,
  });
  const typeRows = FIXTURE.types.map((type, index) => ({
    id: crypto.randomUUID(),
    concert_id: created.id,
    name: type.name,
    kind: type.kind,
    price_huf: type.price_huf,
    capacity: type.capacity,
    sales_start: null,
    sales_end: null,
    active: true,
    sort: index,
    stripe_price_id: null,
    stripe_lookup_key: null,
  }));
  const storedTypes = await ticketDb.upsertTicketTypes(created.id, typeRows);
  assert.equal(storedTypes.length, 2, "expected exactly two stored ticket types");

  const concert = await ticketDb.setConcertStatus(created.id, "on_sale");
  assert.equal(concert?.status, "on_sale", "publishing the throwaway concert failed");

  const fixture = {
    concertId: created.id,
    typeIds: typeRows.map((row) => row.id),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2));
  console.log(`rk_concerts row published on_sale: ${concert.concert_id} (${concert.event_date})`);
  for (const type of storedTypes) {
    console.log(
      `rk_ticket_types row: ${type.name} (${type.kind}) ${type.price_huf} Ft, capacity ${type.capacity}, id ${type.id}`,
    );
  }
  console.log(`fixture state → ${FIXTURE_FILE}`);
}

// ---------------------------------------------------------------------------
// check (a, b, d)
// ---------------------------------------------------------------------------

async function check() {
  const fixture = await loadFixture();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Throwaway concert: ${fixture.concertId}`);

  // The DB's own values for (b) — read through the same service-role REST API
  // the app uses, so the rendered strings are compared against the DB truth.
  const { data: dbTypes, error: typesError } = await supabase
    .from("rk_ticket_types")
    .select("name,kind,price_huf,capacity,sold,active")
    .eq("concert_id", fixture.concertId);
  assert.ok(!typesError, `rk_ticket_types read failed: ${typesError?.message}`);
  const visibleTypes = dbTypes.filter((type) => type.active);
  assert.equal(visibleTypes.length, 2, "expected two active types in the DB");

  // (a) buy page renders with the CTA/form markers
  const buyRes = await fetch(`${BASE_URL}/jegyek/${fixture.concertId}`);
  const buyHtml = await buyRes.text();
  assert.equal(buyRes.status, 200, `buy page answered ${buyRes.status}`);
  const markerMatches = buyHtml.match(/Jegyvásárlás|Elfogadom/g) ?? [];
  assert.ok(markerMatches.length > 0, "buy page rendered no Jegyvásárlás/Elfogadom marker");
  console.log(`a) /jegyek/${fixture.concertId} → HTTP ${buyRes.status}, ` +
    `"Jegyvásárlás|Elfogadom" matches: ${markerMatches.length} (${[...new Set(markerMatches)].join(", ")})`);

  // React SSR separates adjacent text nodes with <!-- --> — the DOM text is what
  // matters, so assert against the comment-stripped copy.
  const buyText = buyHtml.replace(/<!-- -->/g, "");

  // (b) the two type names + prices from the DB are rendered (nbsp thousands)
  for (const type of visibleTypes) {
    const priceText = `${type.price_huf}`.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    const nameAt = buyText.indexOf(type.name);
    assert.ok(nameAt >= 0, `buy page does not render type name "${type.name}"`);
    assert.ok(
      buyText.includes(`${priceText} Ft`),
      `buy page does not render price "${priceText} Ft" for "${type.name}"`,
    );
    const row = buyText.slice(nameAt, nameAt + 220);
    console.log(`b) rendered row for "${type.name}": ${row.match(/[^<>]+/g)?.slice(0, 4).join(" | ")}`);
    console.log(`   price from DB ${type.price_huf} Ft rendered as "${priceText} Ft" ✓`);
  }

  // remaining counts are shown ("Még N db" from capacity-sold)
  for (const type of visibleTypes) {
    const remaining = type.capacity - type.sold;
    assert.ok(
      buyText.includes(`Még ${remaining} db`),
      `buy page does not show remaining ${remaining} for "${type.name}"`,
    );
  }
  console.log(`b) remaining counts rendered for both types (Még ${visibleTypes.map((t) => t.capacity - t.sold).join("/")} db)`);

  // (d) unknown session id → graceful Hungarian message, HTTP 200
  const unknownRes = await fetch(`${BASE_URL}/jegyek/koszonjuk?session_id=cs_test_nem_letezik_12345`);
  const unknownHtml = await unknownRes.text();
  assert.equal(unknownRes.status, 200, `success page answered ${unknownRes.status}`);
  assert.ok(
    unknownHtml.includes("Nem találtuk a fizetést"),
    "success page shows no graceful unknown-session message",
  );
  console.log(`d) /jegyek/koszonjuk?session_id=cs_test_nem_letezik_12345 → HTTP ${unknownRes.status}, message: ` +
    `"${(unknownHtml.match(/Nem találtuk a fizetést[^<]*/) ?? [""])[0]}"`);

  // no session_id at all → still graceful
  const noIdRes = await fetch(`${BASE_URL}/jegyek/koszonjuk`);
  assert.equal(noIdRes.status, 200, `success page without session_id answered ${noIdRes.status}`);
  console.log(`d) /jegyek/koszonjuk (no session_id) → HTTP ${noIdRes.status}, message: ` +
    `"${((await noIdRes.text()).match(/A fizetési azonosító hiányzik[^<]*/) ?? [""])[0]}"`);

  // (d2) success page states with demo orders inserted straight into the DB
  // (same pattern as the card 06 check-in harness; removed in cleanup).
  // Self-healing: a previous `check` run may have left demo rows behind.
  const { data: staleOrders } = await supabase
    .from("rk_orders")
    .select("id")
    .eq("concert_id", fixture.concertId)
    .like("stripe_session_id", "cs_test_demo_%");
  if (staleOrders && staleOrders.length > 0) {
    await supabase.from("rk_tickets").delete().in("order_id", staleOrders.map((o) => o.id));
    await supabase.from("rk_orders").delete().in("id", staleOrders.map((o) => o.id));
    console.log(`   (removed ${staleOrders.length} stale demo order(s) from a previous check run)`);
  }
  const { makeCode } = await import("../lib/ticket-code.ts");
  const demo = {
    fulfilled: { session: "cs_test_demo_fulfilled_" + Date.now(), codes: [makeCode(), makeCode()] },
    pending: { session: "cs_test_demo_pending_" + Date.now() },
  };
  const buyerName = "Teszt Elek";
  const { data: fulfilledOrder, error: fulfilledErr } = await supabase
    .from("rk_orders")
    .insert({
      concert_id: fixture.concertId,
      buyer_name: buyerName,
      buyer_email: null,
      amount_huf: 7000,
      currency: "HUF",
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_session_id: demo.fulfilled.session,
    })
    .select()
    .single();
  assert.ok(!fulfilledErr && fulfilledOrder, `demo paid order insert failed: ${fulfilledErr?.message}`);
  const { error: ticketsErr } = await supabase.from("rk_tickets").insert(
    demo.fulfilled.codes.map((code) => ({
      order_id: fulfilledOrder.id,
      concert_id: fixture.concertId,
      ticket_type_name: "Teljes árú jegy",
      price_huf: 4000,
      code,
      status: "valid",
    })),
  );
  assert.ok(!ticketsErr, `demo ticket insert failed: ${JSON.stringify(ticketsErr)}`);
  const { data: pendingOrder, error: pendingErr } = await supabase
    .from("rk_orders")
    .insert({
      concert_id: fixture.concertId,
      buyer_name: buyerName,
      buyer_email: null,
      amount_huf: 3000,
      currency: "HUF",
      status: "pending",
      stripe_session_id: demo.pending.session,
    })
    .select()
    .single();
  assert.ok(!pendingErr && pendingOrder, `demo pending order insert failed: ${pendingErr?.message}`);

  const fulfilledRes = await fetch(`${BASE_URL}/jegyek/koszonjuk?session_id=${demo.fulfilled.session}`);
  const fulfilledText = (await fulfilledRes.text()).replace(/<!-- -->/g, "");
  assert.equal(fulfilledRes.status, 200, `fulfilled success page answered ${fulfilledRes.status}`);
  assert.ok(fulfilledText.includes("Köszönjük a vásárlást!"), "fulfilled state lacks the thanks heading");
  assert.ok(fulfilledText.includes(buyerName), "fulfilled state lacks the buyer's own name");
  for (const code of demo.fulfilled.codes) {
    assert.ok(fulfilledText.includes(code), `fulfilled state does not show code ${code}`);
  }
  console.log(`d2) fulfilled session → HTTP 200, "Köszönjük a vásárlást!", name "${buyerName}", codes rendered: ${demo.fulfilled.codes.join(", ")}`);
  assert.ok(
    !fulfilledText.includes("e-mailben érkeznek"),
    "fulfilled state must not show the pending sentence",
  );

  const pendingRes = await fetch(`${BASE_URL}/jegyek/koszonjuk?session_id=${demo.pending.session}`);
  const pendingText = (await pendingRes.text()).replace(/<!-- -->/g, "");
  assert.equal(pendingRes.status, 200, `pending success page answered ${pendingRes.status}`);
  assert.ok(pendingText.includes("A jegyek e-mailben érkeznek"), "pending state lacks the e-mail sentence");
  for (const code of demo.fulfilled.codes) {
    assert.ok(!pendingText.includes(code), `pending state must not show code ${code}`);
  }
  console.log(`d2) pending session → HTTP 200, "A jegyek e-mailben érkeznek" state, no codes shown`);

  console.log("ALL CHECKS PASSED (a, b, d, d2) — (c) and (e) run with the browser tool against the same fixture");
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  const fixture = await loadFixture();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // The `check` run may have left demo orders (session ids prefixed
  // cs_test_demo_) with their tickets — remove exactly those first.
  const { data: demoOrders } = await supabase
    .from("rk_orders")
    .select("id,stripe_session_id")
    .eq("concert_id", fixture.concertId)
    .like("stripe_session_id", "cs_test_demo_%");
  if (demoOrders && demoOrders.length > 0) {
    const { data: demoTickets, error: probeError } = await supabase
      .from("rk_tickets")
      .select("id")
      .in("order_id", demoOrders.map((order) => order.id));
    assert.ok(!probeError, `demo rk_tickets probe failed: ${JSON.stringify(probeError)}`);
    if (demoTickets && demoTickets.length > 0) {
      const { error: demoTicketsError } = await supabase
        .from("rk_tickets")
        .delete()
        .in("order_id", demoOrders.map((order) => order.id));
      assert.ok(!demoTicketsError, `demo rk_tickets delete failed: ${JSON.stringify(demoTicketsError)}`);
    }
    const { error: demoOrdersError } = await supabase
      .from("rk_orders")
      .delete()
      .in("id", demoOrders.map((order) => order.id));
    const { data: demoOrdersLeft } = await supabase
      .from("rk_orders")
      .select("id")
      .eq("concert_id", fixture.concertId)
      .like("stripe_session_id", "cs_test_demo_%");
    assert.ok(
      !(demoOrdersLeft && demoOrdersLeft.length > 0),
      `demo rk_orders delete failed (rows remain): ${JSON.stringify(demoOrdersError)} / ${JSON.stringify(demoOrdersLeft?.map((o) => o.id))}`,
    );
    console.log(`REMOVED demo rows from check (d2): ${demoOrders.length} rk_orders ` +
      `+ ${demoTickets?.length ?? 0} rk_tickets (sessions ${demoOrders.map((o) => o.stripe_session_id).join(", ")})`);
  }

  const before = (await admin.listUpcomingConcerts()).length;
  const orders = await supabase
    .from("rk_orders")
    .select("id")
    .eq("concert_id", fixture.concertId);
  const tickets = await supabase
    .from("rk_tickets")
    .select("id")
    .eq("concert_id", fixture.concertId);
  assert.ok(!orders.error && !tickets.error, `order/ticket probe failed: ${orders.error?.message ?? tickets.error?.message}`);
  assert.equal(orders.data.length, 0, `throwaway concert has ${orders.data.length} order(s) — remove them manually first`);
  assert.equal(tickets.data.length, 0, `throwaway concert has ${tickets.data.length} ticket(s) — remove them manually first`);

  // Idempotent on purpose: every removal first checks what is actually still
  // there, so a re-run after a partial cleanup is safe. (Supabase quirk seen
  // during verification: a `.delete().in(...)` sometimes returns a truthy error
  // object with a null message even though the rows WERE deleted — verify with
  // a select before trusting either answer.)
  let removedLine = false;
  try {
    await admin.deleteConcert(fixture.concertId);
    removedLine = true;
  } catch (err) {
    const stillThere = (await admin.listUpcomingConcerts()).some(
      (concert) => concert.id === fixture.concertId,
    );
    if (stillThere) throw err;
    console.log(`S3 line id=${fixture.concertId}: already removed (nothing to do)`);
  }
  if (removedLine) {
    console.log(`REMOVED from the S3 upcoming file: line id=${fixture.concertId} (lines ${before} → ${before - 1})`);
  }

  const { data: remainingTypes } = await supabase
    .from("rk_ticket_types")
    .select("id")
    .eq("concert_id", fixture.concertId);
  if (remainingTypes && remainingTypes.length > 0) {
    const { error: typesError } = await supabase
      .from("rk_ticket_types")
      .delete()
      .eq("concert_id", fixture.concertId);
    assert.ok(!typesError, `rk_ticket_types delete failed: ${JSON.stringify(typesError)}`);
    console.log(`REMOVED from rk_ticket_types: ${remainingTypes.length} row(s) of concert ${fixture.concertId}`);
  }

  const { data: remainingConcert } = await supabase
    .from("rk_concerts")
    .select("concert_id")
    .eq("concert_id", fixture.concertId)
    .maybeSingle();
  if (remainingConcert) {
    const { error: concertError } = await supabase
      .from("rk_concerts")
      .delete()
      .eq("concert_id", fixture.concertId);
    assert.ok(!concertError, `rk_concerts delete failed: ${JSON.stringify(concertError)}`);
    console.log(`REMOVED from rk_concerts: row concert_id=${fixture.concertId}`);
  }
  console.log("Stripe: nothing to remove — no price, product or session was created for this fixture");
}

// ---------------------------------------------------------------------------

const command = process.argv[2] ?? "check";
if (command === "setup") await setup();
else if (command === "check") await check();
else if (command === "cleanup") await cleanup();
else {
  console.error(`Unknown command "${command}" — use setup | check | cleanup`);
  process.exit(1);
}
