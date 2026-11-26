// Verification harness for card 13 (Elővételes jegy: kezdő/záró dátum).
//
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/card13-earlybird-window-check.mjs check    # full run, keeps the fixture (browser run follows)
//   node scripts/card13-earlybird-window-check.mjs cleanup   # Stripe deactivate/archive + DB removal
//
// The throwaway concert is written straight to Supabase with the service key
// (same approach as the card 10/11/12 harnesses); the single early-bird type
// is saved through the REAL dashboard API (PUT /api/intern/koncertek/[id]/
// ticket-types), so the Stripe price it creates is a live object — cleanup
// deactivates the price and archives the product (the blessed dance from
// card 03: prices have no delete, products with prices cannot be deleted).
// No Checkout Session is ever created (the window refusal fires before the
// session in the pipeline), no payment, no e-mail to an invented buyer.
//
// Checks:
//   a) save early bird start = today, end = tomorrow → stored as the days'
//      Europe/Budapest boundaries (00:00:00 / 23:59:59), asserted against
//      the script's own offset math and printed raw + in Budapest wall time;
//   b) publish → buy page renders the deadline „Elővételes ár – <hónap> <nap>-ig”;
//   c) intern detail page (SSR, cookie) renders the date inputs and the
//      „Elővételes: nov. X. – nov. Y.” row summary;
//   d) end = yesterday → type disappears from the buy page, the page says
//      „A jegyértékesítés erre a koncertre lezárult.”, and a direct checkout
//      POST for the type returns the existing Hungarian window refusal
//      (no order row is written);
//   e) end < start → PUT refused in Hungarian, DB unchanged;
//   f) end after the concert date → PUT refused in Hungarian, DB unchanged;
//   g) malformed day (2026-02-30) → PUT refused as unparseable, DB unchanged;
//   h) a standard type sent WITH dates is stored with null window;
//   cleanup: Stripe price deactivated + product archived (ids printed),
//      DB rows deleted and the emptiness re-read (ids printed).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// ---------------------------------------------------------------------------
// Environment (the same .env.local the dev server reads, quotes stripped)
// ---------------------------------------------------------------------------

function parseDotEnv() {
  const out = {};
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split("\r\n").join("\n").split("\n")) {
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
    /* .env.local missing — fall back to process.env below */
  }
  return out;
}

const fileEnv = parseDotEnv();
const env = (name) => process.env[name] || fileEnv[name] || "";

const BASE_URL = process.env.TICKET_API_BASE_URL || "http://localhost:3001";
const COOKIE = "rezkorut-intern-auth=1";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_KEY = env("STRIPE_SECRET_KEY");

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
assert.ok(STRIPE_KEY, "STRIPE_SECRET_KEY must be in .env.local");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" });

// ---------------------------------------------------------------------------
// Fixture state (scratch file so check and cleanup are separate invocations)
// ---------------------------------------------------------------------------

const FIXTURE_FILE = join(
  homedir(),
  ".hermes/profiles/coder/cache/scratch/card13-earlybird-fixture.json",
);

// ---------------------------------------------------------------------------
// Calendar days + the script's OWN Europe/Budapest boundary math (independent
// of lib/budapest-time — that is what makes the stored-value asserts real)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in Europe/Budapest right now. */
function budapestToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
}

function addDays(day, count) {
  const ms = Date.parse(`${day}T00:00:00Z`) + count * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Europe/Budapest offset (minutes) at a given instant, DST-safe. */
function budapestOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    timeZoneName: "longOffset",
  });
  const part = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 60;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** UTC milliseconds of `day`'s 00:00:00 / 23:59:59 in Budapest wall time. */
function budapestBoundaryMs(day, time) {
  const guess = Date.parse(`${day}T${time}Z`);
  let offset = budapestOffsetMinutes(new Date(guess));
  let instant = guess - offset * 60_000;
  offset = budapestOffsetMinutes(new Date(instant));
  instant = guess - offset * 60_000;
  return instant;
}

/** `2026-11-27T22:59:59.000Z` → `2026.11.27. 23:59:59` in Budapest wall time. */
function renderBudapest(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(new Date(iso))
    .replace(/-/g, ".")
    .replace(" ", ". ");
}

const HU_MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];
const HU_MONTH_ABBREVS = [
  "jan.",
  "febr.",
  "márc.",
  "ápr.",
  "máj.",
  "jún.",
  "júl.",
  "aug.",
  "szept.",
  "okt.",
  "nov.",
  "dec.",
];

function monthOf(day) {
  return Number(day.slice(5, 7));
}
function dayOf(day) {
  return Number(day.slice(8, 10));
}

// ---------------------------------------------------------------------------
// Supabase / fetch helpers
// ---------------------------------------------------------------------------

async function getTypeRows(concertId) {
  const { data, error } = await supabase
    .from("rk_ticket_types")
    .select("*")
    .eq("concert_id", concertId);
  assert.ok(!error, `rk_ticket_types read failed: ${error?.message}`);
  return data ?? [];
}

async function getConcertRow(concertId) {
  const { data, error } = await supabase
    .from("rk_concerts")
    .select("*")
    .eq("concert_id", concertId)
    .maybeSingle();
  assert.ok(!error, `rk_concerts read failed: ${error?.message}`);
  return data ?? null;
}

async function api(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: COOKIE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** SSR HTML of an intern page, with React's `<!-- -->` separators stripped. */
async function internPage(path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: { cookie: COOKIE } });
  const text = await response.text();
  return { status: response.status, text, clean: text.replace(/<!-- -->/g, "") };
}

// ---------------------------------------------------------------------------
// Setup / check / cleanup
// ---------------------------------------------------------------------------

const TODAY = budapestToday();
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY = addDays(TODAY, -1);
const CONCERT_DAY = addDays(TODAY, 7);
const AFTER_CONCERT = addDays(CONCERT_DAY, 1);

const TITLE = "Teszt koncert – card 13";
const VENUE = "Teszt Terem";
const TYPE_NAME = "Elővételes jegy";

/** Set by setup(): the id the dashboard API derived for the throwaway concert. */
let CONCERT_ID = null;

function loadFixture() {
  if (!existsSync(FIXTURE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function stripeDeactivate(priceId) {
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  await stripe.prices.update(priceId, { active: false });
  const product = typeof price.product === "string" ? price.product : price.product?.id ?? null;
  if (product) {
    await stripe.products.update(product, { active: false });
  }
  return { priceId, productId: product };
}

async function wipeDb(concertId) {
  await supabase.from("rk_tickets").delete().eq("concert_id", concertId);
  await supabase.from("rk_orders").delete().eq("concert_id", concertId);
  await supabase.from("rk_ticket_types").delete().eq("concert_id", concertId);
  await supabase.from("rk_concerts").delete().eq("concert_id", concertId);
  // The .delete().in() error object can be truthy with message:null even on
  // success — re-read and assert instead of trusting it (card 05 lesson).
  for (const [table, column] of [
    ["rk_tickets", "id"],
    ["rk_orders", "id"],
    ["rk_ticket_types", "id"],
    ["rk_concerts", "concert_id"],
  ]) {
    const { count, error } = await supabase
      .from(table)
      .select(column, { count: "exact", head: true })
      .eq("concert_id", concertId);
    assert.ok(!error, `${table} count failed: ${error?.message}`);
    assert.equal(count, 0, `${table} must be empty for ${concertId} after cleanup`);
  }
}

async function setup() {
  console.log(`Days (Europe/Budapest): today=${TODAY}, tomorrow=${TOMORROW}, yesterday=${YESTERDAY}, concert=${CONCERT_DAY}`);

  // Idempotent setup. The intern dashboard only shows concerts that exist in
  // the live S3 upcoming file, so the throwaway concert goes through the REAL
  // dashboard API (POST writes the S3 line + the rk_concerts mirror) and
  // cleanup removes it the same way (DELETE). Leftovers from an aborted run:
  // same-title lines in the S3 list → API DELETE + direct DB wipe; the old
  // fixture's Stripe objects are deactivated best-effort.
  const old = loadFixture();
  if (old?.stripePriceId) {
    try {
      const done = await stripeDeactivate(old.stripePriceId);
      console.log(`leftover Stripe objects deactivated: price ${done.priceId}, product ${done.productId}`);
    } catch (err) {
      console.log(`leftover Stripe deactivation skipped: ${err?.message ?? err}`);
    }
  }
  if (old?.concertId) {
    await wipeDb(old.concertId);
  }

  // Safety net for runs aborted before the fixture was written: any rk_*
  // residue of this harness (concert ids containing "card13") goes away,
  // Stripe prices included.
  const { data: stale, error: staleError } = await supabase
    .from("rk_concerts")
    .select("concert_id")
    .ilike("concert_id", "%card13%");
  assert.ok(!staleError, `stale rk_concerts read failed: ${staleError?.message}`);
  for (const staleRow of stale ?? []) {
    const staleTypes = await getTypeRows(staleRow.concert_id);
    for (const staleType of staleTypes) {
      if (staleType.stripe_price_id) {
        try {
          const done = await stripeDeactivate(staleType.stripe_price_id);
          console.log(`stale Stripe objects deactivated: price ${done.priceId}, product ${done.productId}`);
        } catch (err) {
          console.log(`stale Stripe deactivation skipped: ${err?.message ?? err}`);
        }
      }
    }
    await wipeDb(staleRow.concert_id);
    console.log(`stale rk_* rows wiped: ${staleRow.concert_id}`);
  }

  const list = await api("GET", "/api/intern/koncertek");
  assert.equal(list.status, 200, `the intern list API must answer 200 (body: ${JSON.stringify(list.json)})`);
  const strays = (list.json?.concerts ?? []).filter((concert) => concert.title === TITLE);
  for (const stray of strays) {
    if (!stray.id) continue;
    const del = await api("DELETE", `/api/intern/koncertek/${stray.id}`);
    console.log(`leftover concert removed via API: ${stray.id} → HTTP ${del.status}`);
    await wipeDb(stray.id);
  }

  const created = await api("POST", "/api/intern/koncertek", {
    date: CONCERT_DAY,
    time: "19:00",
    location: "Budapest",
    venue: VENUE,
    title: TITLE,
  });
  assert.equal(
    created.status,
    200,
    `the dashboard POST must create the throwaway concert (body: ${JSON.stringify(created.json)})`,
  );
  CONCERT_ID = created.json?.concert?.id ?? null;
  assert.ok(CONCERT_ID, "the created concert must carry its derived id");
  console.log(`throwaway concert: ${CONCERT_ID} (S3 line + rk_concerts mirror, status ${created.json?.ticketing?.status ?? "draft"})`);
  return CONCERT_ID;
}

async function check() {
  await setup();

  // --- a) save the early bird with start = today, end = tomorrow ---
  const earlyBird = {
    name: TYPE_NAME,
    kind: "early_bird",
    price_huf: 2000,
    capacity: 10,
    sales_start: TODAY,
    sales_end: TOMORROW,
    active: true,
    sort: 0,
  };
  const saved = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [earlyBird],
  });
  console.log(`\na) PUT early bird (start ${TODAY}, end ${TOMORROW}) → HTTP ${saved.status}`);
  assert.equal(saved.status, 200, `the dashboard PUT must answer 200 (body: ${JSON.stringify(saved.json)})`);
  const savedType = saved.json?.types?.[0];
  assert.ok(savedType?.id, "the saved type must carry an id");
  assert.equal(savedType.kind, "early_bird");
  console.log(`   response sales_start: ${savedType.sales_start}`);
  console.log(`   response sales_end:   ${savedType.sales_end}`);

  const expectedStart = budapestBoundaryMs(TODAY, "00:00:00");
  const expectedEnd = budapestBoundaryMs(TOMORROW, "23:59:59");
  assert.equal(
    Date.parse(savedType.sales_start),
    expectedStart,
    `sales_start must be ${TODAY} 00:00:00 Budapest, got ${savedType.sales_start}`,
  );
  assert.equal(
    Date.parse(savedType.sales_end),
    expectedEnd,
    `sales_end must be ${TOMORROW} 23:59:59 Budapest, got ${savedType.sales_end}`,
  );

  // DB row: print the stored values raw + in Budapest wall time.
  const rowsAfterA = await getTypeRows(CONCERT_ID);
  assert.equal(rowsAfterA.length, 1, "exactly one type row after the first save");
  const rowA = rowsAfterA[0];
  console.log(`   DB sales_start: ${rowA.sales_start}  (= ${renderBudapest(rowA.sales_start)} Budapest)`);
  console.log(`   DB sales_end:   ${rowA.sales_end}  (= ${renderBudapest(rowA.sales_end)} Budapest)`);
  assert.equal(Date.parse(rowA.sales_end), expectedEnd, "the DB row must carry the same boundary as the response");
  assert.ok(
    renderBudapest(rowA.sales_end).startsWith(TOMORROW.replaceAll("-", "."))
      && renderBudapest(rowA.sales_end).endsWith("23:59:59"),
    `the stored end must render as ${TOMORROW} 23:59:59 in Budapest`,
  );
  const TYPE_ID = rowA.id;
  const STRIPE_PRICE_ID = rowA.stripe_price_id;
  assert.ok(STRIPE_PRICE_ID, "the paid early bird must carry a Stripe price id");
  console.log(`   type id: ${TYPE_ID}, Stripe price: ${STRIPE_PRICE_ID} (created, never used in a session)`);

  // --- publish, then the buy page shows the deadline ---
  const published = await api("POST", `/api/intern/koncertek/${CONCERT_ID}/publish`);
  assert.equal(published.status, 200, `publish must answer 200 (body: ${JSON.stringify(published.json)})`);
  console.log(`\n   publish → HTTP ${published.status}, status: ${published.json?.concert?.status}`);

  const deadlineText = `Elővételes ár – ${HU_MONTHS[monthOf(TOMORROW) - 1]} ${dayOf(TOMORROW)}-ig`;
  const buyA = await internPage(`/jegyek/${CONCERT_ID}`);
  console.log(`\nb) GET /jegyek/${CONCERT_ID} → HTTP ${buyA.status}`);
  assert.equal(buyA.status, 200, "the buy page must answer 200");
  assert.ok(buyA.clean.includes(TYPE_NAME), "the buy page must render the early-bird type while the window is open");
  assert.ok(
    buyA.clean.includes(deadlineText),
    `the buy page must render „${deadlineText}”`,
  );
  console.log(`   rendered deadline: „${deadlineText}”`);

  // --- c) the intern detail page (SSR): date inputs + row summary ---
  const detailA = await internPage(`/intern/koncertek/${CONCERT_ID}`);
  console.log(`\nc) GET /intern/koncertek/${CONCERT_ID} → HTTP ${detailA.status}`);
  assert.equal(detailA.status, 200, "the intern detail page must answer 200");
  assert.ok(detailA.clean.includes("Elővételes ár kezdete"), "the editor must label the start date input");
  assert.ok(detailA.clean.includes("Elővételes ár vége"), "the editor must label the end date input");
  const summaryText = `Elővételes: ${HU_MONTH_ABBREVS[monthOf(TODAY) - 1]} ${dayOf(TODAY)}. – ${
    HU_MONTH_ABBREVS[monthOf(TOMORROW) - 1]
  } ${dayOf(TOMORROW)}.`;
  assert.ok(detailA.clean.includes(summaryText), `the row summary must render „${summaryText}”`);
  assert.ok(detailA.text.includes(`value="${TODAY}"`), "the start input must carry the stored day");
  assert.ok(detailA.text.includes(`value="${TOMORROW}"`), "the end input must carry the stored day");
  console.log(`   rendered row summary: „${summaryText}” (editor + összegzés)`);
  console.log(`   date inputs carry value="${TODAY}" / value="${TOMORROW}"`);

  // --- d) end = yesterday → hidden from the buy page, checkout refused ---
  const closed = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [{ ...earlyBird, id: TYPE_ID, sales_start: null, sales_end: YESTERDAY }],
  });
  console.log(`\nd) PUT early bird (start null, end ${YESTERDAY}) → HTTP ${closed.status}`);
  assert.equal(closed.status, 200, "closing the window must save (body: " + JSON.stringify(closed.json) + ")");
  const closedType = closed.json?.types?.[0];
  console.log(`   response sales_start: ${closedType.sales_start}`);
  console.log(`   response sales_end:   ${closedType.sales_end}  (= ${renderBudapest(closedType.sales_end)} Budapest)`);
  assert.equal(closedType.sales_start, null, "an unset start must persist as null");
  assert.equal(
    Date.parse(closedType.sales_end),
    budapestBoundaryMs(YESTERDAY, "23:59:59"),
    `sales_end must be ${YESTERDAY} 23:59:59 Budapest`,
  );

  const buyB = await internPage(`/jegyek/${CONCERT_ID}`);
  const closedSummary = `Elővételes: ${HU_MONTH_ABBREVS[monthOf(YESTERDAY) - 1]} ${dayOf(YESTERDAY)}-ig`;
  // The raw HTML embeds Next's RSC flight payload (dev), which carries the
  // fetched types JSON — the type NAME can appear there while the row is
  // hidden. The RENDERED markers are the proof: the deadline line and the
  // remaining counter are formatted in the component, never in the payload.
  assert.ok(
    !buyB.clean.includes(deadlineText),
    "the expired early bird's deadline line must disappear from the buy page",
  );
  assert.ok(!buyB.clean.includes("Még 10 db"), "the expired early bird's remaining counter must disappear");
  assert.ok(
    buyB.clean.includes("A jegyértékesítés erre a koncertre lezárult."),
    "with the early bird as the only type the page must say the sales closed",
  );
  console.log(`   buy page: row hidden (deadline line and remaining counter gone), renders „A jegyértékesítés erre a koncertre lezárult.”`);
  const detailB = await internPage(`/intern/koncertek/${CONCERT_ID}`);
  assert.ok(detailB.clean.includes(closedSummary), `the row summary must render „${closedSummary}” (end only)`);
  console.log(`   dashboard row summary: „${closedSummary}”`);

  const checkout = await fetch(`${BASE_URL}/api/tickets/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      concert_id: CONCERT_ID,
      items: [{ ticket_type_id: TYPE_ID, quantity: 1 }],
      buyer: {
        name: "Teszt Elek",
        email: "teszt@rezkorut.hu",
        phone: "+36 1 234 5678",
        address: { postal_code: "1133", city: "Budapest", street: "Teszt utca 1." },
      },
      accept_terms: true,
    }),
  });
  const checkoutJson = await checkout.json().catch(() => null);
  console.log(`   direct checkout POST → HTTP ${checkout.status}, error: ${checkoutJson?.error}`);
  assert.equal(checkout.status, 400, "the out-of-window checkout must be refused with 400");
  assert.equal(
    checkoutJson?.message,
    "Az elővétel ennél a jegytípusnál már lejárt.",
    "the refusal must be the existing Hungarian window message",
  );
  console.log(`   refusal: „${checkoutJson.message}”`);
  const { count: orderCount } = await supabase
    .from("rk_orders")
    .select("id", { count: "exact", head: true })
    .eq("concert_id", CONCERT_ID);
  assert.equal(orderCount, 0, "the refused checkout must not write an order row");

  // --- e) end before start → refused, nothing saved ---
  const refusedE = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [{ ...earlyBird, id: TYPE_ID, sales_start: TOMORROW, sales_end: YESTERDAY }],
  });
  console.log(`\ne) PUT end < start → HTTP ${refusedE.status}, error: ${refusedE.json?.error}`);
  assert.equal(refusedE.status, 400, "end before start must be refused");
  assert.equal(
    refusedE.json?.error,
    "Az elővételes ár vége nem lehet korábbi, mint a kezdete.",
    "the end-before-start refusal must be the editor's Hungarian message",
  );

  // --- f) end after the concert date → refused ---
  const refusedF = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [{ ...earlyBird, id: TYPE_ID, sales_start: null, sales_end: AFTER_CONCERT }],
  });
  console.log(`\nf) PUT end > concert date (${AFTER_CONCERT} > ${CONCERT_DAY}) → HTTP ${refusedF.status}, error: ${refusedF.json?.error}`);
  assert.equal(refusedF.status, 400, "an end after the concert date must be refused");
  assert.equal(
    refusedF.json?.error,
    "Az elővételes ár vége nem lehet a koncert dátuma után.",
    "the after-concert refusal must be the editor's Hungarian message",
  );

  // --- g) malformed day → refused as unparseable ---
  const refusedG = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [{ ...earlyBird, id: TYPE_ID, sales_start: null, sales_end: "2026-02-30" }],
  });
  console.log(`\ng) PUT malformed day (2026-02-30) → HTTP ${refusedG.status}, error: ${refusedG.json?.error}`);
  assert.equal(refusedG.status, 400, "a nonexistent calendar day must be refused");
  assert.equal(refusedG.json?.error, "Értelmezhetetlen értékesítés-vég.");

  // e/f/g: nothing was saved — the row still carries the phase-d window.
  const rowsAfterRefusals = await getTypeRows(CONCERT_ID);
  assert.equal(rowsAfterRefusals.length, 1, "the refused PUTs must not change the type list");
  assert.equal(
    Date.parse(rowsAfterRefusals[0].sales_end),
    budapestBoundaryMs(YESTERDAY, "23:59:59"),
    "the refused PUTs must leave the stored window untouched",
  );
  console.log(`\n   refused saves left the DB untouched: sales_end = ${rowsAfterRefusals[0].sales_end}`);

  // --- h) a standard type sent WITH dates stores null ---
  const mixed = await api("PUT", `/api/intern/koncertek/${CONCERT_ID}/ticket-types`, {
    types: [
      { ...earlyBird, id: TYPE_ID, sales_start: null, sales_end: YESTERDAY },
      {
        name: "Teljes árú jegy",
        kind: "standard",
        price_huf: 4000,
        capacity: 50,
        sales_start: TODAY,
        sales_end: TOMORROW,
        active: true,
        sort: 1,
      },
    ],
  });
  console.log(`\nh) PUT with a standard type carrying dates → HTTP ${mixed.status}`);
  assert.equal(mixed.status, 200, "the mixed save must succeed (body: " + JSON.stringify(mixed.json) + ")");
  const standardType = (mixed.json?.types ?? []).find((type) => type.kind === "standard");
  assert.ok(standardType, "the standard type must be saved");
  assert.equal(standardType.sales_start, null, "a standard type must never store a window start");
  assert.equal(standardType.sales_end, null, "a standard type must never store a window end");
  console.log(`   standard type stored with sales_start=${standardType.sales_start}, sales_end=${standardType.sales_end}`);

  // Fixture for the browser run + the cleanup phase.
  const fixture = {
    concertId: CONCERT_ID,
    typeId: TYPE_ID,
    standardTypeId: standardType.id,
    stripePriceId: STRIPE_PRICE_ID,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2));
  console.log(`\nfixture state → ${FIXTURE_FILE}`);
  console.log(`NEXT STEP: browser run of the inline editor validation, then: node scripts/card13-earlybird-window-check.mjs cleanup`);
  console.log("ALL CHECKS PASSED");
}

async function cleanup() {
  const fixture = loadFixture();
  assert.ok(fixture?.concertId, `no fixture to clean up (expected ${FIXTURE_FILE})`);
  console.log(`cleanup of ${fixture.concertId}`);

  // Stripe first — the price id lives in the type row, which the concert
  // delete would cascade away (card 03 lesson).
  let stripeIds = { priceId: fixture.stripePriceId ?? null, productId: null };
  const rows = await getTypeRows(fixture.concertId);
  const row = rows.find((type) => type.id === fixture.typeId) ?? rows[0];
  const priceId = row?.stripe_price_id ?? fixture.stripePriceId ?? null;
  if (priceId) {
    const done = await stripeDeactivate(priceId);
    stripeIds = done;
    console.log(`Stripe price deactivated: ${done.priceId}`);
    console.log(`Stripe product archived:  ${done.productId}`);
  } else {
    console.log("no Stripe price to deactivate");
  }

  // The dashboard API removes the S3 line and CLOSES the rk_concerts row —
  // the direct wipe afterwards leaves rk_* empty (rows are never deleted by
  // the API because orders reference them; there are none here).
  const del = await api("DELETE", `/api/intern/koncertek/${fixture.concertId}`);
  console.log(`API DELETE → HTTP ${del.status} (S3 line removed, rk_concerts row closed)`);
  assert.ok(del.status === 200 || del.status === 404, "the API DELETE must succeed or find nothing");

  await wipeDb(fixture.concertId);
  console.log(`rk_concerts row deleted (after the API close): ${fixture.concertId}`);
  console.log(`rk_ticket_types rows deleted: ${fixture.typeId}${fixture.standardTypeId ? `, ${fixture.standardTypeId}` : ""}`);
  console.log(`rk_orders/rk_tickets: none existed (0 rows re-read)`);
}

const command = process.argv[2] ?? "check";
if (command === "check") {
  await check();
} else if (command === "cleanup") {
  await cleanup();
} else {
  console.error(`unknown command: ${command} (use check | cleanup)`);
  process.exit(1);
}
