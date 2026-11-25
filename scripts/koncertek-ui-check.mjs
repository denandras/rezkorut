// Verification harness for card 06 (Koncertek intern dashboard + check-in).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/koncertek-ui-check.mjs
//
// Same style as card 02's scripts/ticket-api-check.mjs (node >= 22.18 native
// type-stripping): fetches the PAGES with the intern cookie and asserts on
// the rendered HTML, drives the same intern API routes the dashboard's forms
// drive, reads the live S3 file back directly, inserts the check-in fixture
// rows through the service role key, and cleans up every row, S3 line and
// Stripe object it created (printing the ids).
//
// Proofs (per the card):
//   a) GET /intern/koncertek with cookie → 200 and the HTML contains the two
//      real concerts (+ the „Számlázás (TACITo)” tile); without the cookie
//      the titles are absent (gate).
//   b) create → edit → delete a throwaway concert through the UI routes,
//      printing the API results and the S3 line count before/after.
//   c) publish a throwaway concert with one type, then GET the detail page
//      and print the rendered status pill + price.
//   d) check-in: POST a code belonging to a fake paid order on that concert
//      (inserted directly into the DB by this script) → „Érvényes jegy”
//      (dirty input: lowercase + dashes + spaces); POST again →
//      „Már beolvasva”; POST a code from another concert →
//      „Másik koncertre szól”; POST an unknown code → „Ismeretlen kód”.
//   e) GET /intern lists the new „Koncertek” card, placed first.
// Cleanup: fixture tickets/orders, the throwaway concerts' S3 lines and DB
// rows, and the Stripe price/product the type editor created (prices cannot
// be deleted through the API — deactivated; the product is deleted, or
// archived when Stripe refuses while prices exist). No Checkout Session,
// charge or refund is ever created.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

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
const COOKIE = "rezkorut-intern-auth=1";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_KEY = env("STRIPE_SECRET_KEY");
const stripeMode = STRIPE_KEY ? (STRIPE_KEY.startsWith("sk_live_") ? "live" : "test") : null;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`Stripe key mode: ${stripeMode ?? "MISSING"}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" }) : null;

// ---------------------------------------------------------------------------
// "@/ alias hook + lib imports (live S3 concert admin, ticket codes)
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
const ticketCode = await import("../lib/ticket-code.ts");

// ---------------------------------------------------------------------------
// Live S3 raw file access (independent of lib/ — reads the actual bytes)
// ---------------------------------------------------------------------------

function s4Config() {
  const endpoint = env("S4_ENDPOINT");
  const accessKeyId = env("S4_ACCESS_KEY_ID");
  const secretAccessKey = env("S4_SECRET_ACCESS_KEY");
  const bucket = env("S4_BUCKET") || "tb1";
  const region = env("S4_REGION") || "us-east-1";
  const prefix = env("S4_UPCOMING_PREFIX");
  assert.ok(endpoint && accessKeyId && secretAccessKey && prefix, "S4_* env must be configured");
  return { endpoint, accessKeyId, secretAccessKey, bucket, region, prefix };
}

function makeS3(cfg) {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

async function readLiveFileRaw() {
  const cfg = s4Config();
  const client = makeS3(cfg);
  const prefix = cfg.prefix.endsWith("/") ? cfg.prefix : `${cfg.prefix}/`;
  let token;
  let key = null;
  do {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 500 }),
    );
    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue;
      const name = (obj.Key.split("/").pop() ?? "").toLowerCase();
      if (name === "rezkorut-upcoming-concerts.md") {
        key = obj.Key;
        break;
      }
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token && !key);
  if (!key) throw new Error("upcoming concerts file not found in S4");
  const obj = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const content = await obj.Body?.transformToString("utf-8");
  return content ?? "";
}

function concertLines(content) {
  return content.split(/\r?\n/).filter((line) => line.trim().startsWith("- "));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, body, { withCookie = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(withCookie ? { Cookie: COOKIE } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function page(path, { withCookie = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: withCookie ? { Cookie: COOKIE } : {},
    signal: AbortSignal.timeout(120_000),
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, text };
}

/**
 * Renders comparable: drops React's SSR comment separators and HTML tags (a
 * text can span an element boundary — the used/sold counter puts its second
 * half inside a span), unescapes entities, flattens nbsp and whitespace.
 */
function cleanHtml(html) {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Section runner
// ---------------------------------------------------------------------------

const failures = [];
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
    console.log("   -> ok");
  } catch (err) {
    failures.push(name);
    console.error(`   -> FAIL\n      ${err?.stack ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Throwaway data
// ---------------------------------------------------------------------------

const HU_MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];
const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
const futureHuDate = `${future.getFullYear()}. ${HU_MONTHS[future.getMonth()]} ${future.getDate()}.`;

const TITLE_B = "UI-teszt koncert – törlendő";
const TITLE_B_EDITED = "UI-teszt koncert – javítva";
const TITLE_C = "UI-teszt koncert – árúsítás";
const TITLE_D = "UI-teszt koncert – másik";
const TYPE_NAME = "Teszt jegy";
/** Stripe product names of the throwaways: `Réz körút – UI-teszt koncert – …` */
const STRIPE_SWEEP_PREFIX = "Réz körút – UI-teszt";

let baselineLineCount = null;
let concertBId = null;
let concertCId = null;
let concertDId = null;
let concertCTypeId = null;
let stripePriceId = null;
let stripeProductId = null;
let fixtureOrderIdA = null;
let fixtureOrderIdB = null;
let fixtureTicketIds = [];
let codeX = null;
let codeY = null;

console.log(`Throwaway concerts (date ${futureHuDate}): "${TITLE_B}", "${TITLE_C}", "${TITLE_D}"`);

// ---------------------------------------------------------------------------
// Cleanup (idempotent; runs even when a section fails)
// ---------------------------------------------------------------------------

async function deleteThrowawayRows() {
  const ids = new Set([concertBId, concertCId, concertDId].filter(Boolean));
  const { data: leftovers, error: selectError } = await supabase
    .from("rk_concerts")
    .select("concert_id,title")
    .like("title", "UI-teszt koncert%");
  if (selectError) throw new Error(`rk_concerts select failed: ${selectError.message}`);
  for (const row of leftovers ?? []) ids.add(row.concert_id);

  const removed = [];
  for (const id of ids) {
    const { data: tickets } = await supabase.from("rk_tickets").select("id").eq("concert_id", id);
    for (const ticket of tickets ?? []) {
      await supabase.from("rk_tickets").delete().eq("id", ticket.id);
      fixtureTicketIds.push(ticket.id);
    }
    const { data: orders } = await supabase.from("rk_orders").select("id").eq("concert_id", id);
    for (const order of orders ?? []) {
      await supabase.from("rk_orders").delete().eq("id", order.id);
    }
    // Ticket types cascade with the concert row.
    const del = await supabase.from("rk_concerts").delete().eq("concert_id", id);
    if (del.error) throw new Error(`rk_concerts delete failed: ${del.error.message}`);
    removed.push(id);
  }

  // Sweep fixture tickets/orders by code (a crashed run may have left them
  // behind, keyed to any concert).
  for (const code of [codeX, codeY].filter(Boolean)) {
    const { data: stale } = await supabase.from("rk_tickets").select("id,order_id").eq("code", code);
    for (const ticket of stale ?? []) {
      await supabase.from("rk_tickets").delete().eq("id", ticket.id);
      await supabase.from("rk_orders").delete().eq("id", ticket.order_id);
      removed.push(`ticket ${ticket.id} (code ${code})`);
    }
  }
  return removed;
}

async function cleanup() {
  console.log("\n== cleanup (idempotent)");
  try {
    // S3: remove every throwaway line that is still present.
    const concerts = await admin.listUpcomingConcerts();
    const stale = concerts.filter((concert) =>
      [TITLE_B, TITLE_B_EDITED, TITLE_C, TITLE_D].includes(concert.title),
    );
    for (const concert of stale) {
      if (!concert.id) {
        console.error(`   REFUSING S3 cleanup: leftover concert without id: ${concert.title}`);
        continue;
      }
      await admin.deleteConcert(concert.id);
      console.log(`   S3 line removed: ${concert.id} (${concert.title})`);
    }
    if (!stale.length) console.log("   S3: no throwaway line present");

    const removed = await deleteThrowawayRows();
    console.log(`   DB concert rows deleted: ${removed.length ? removed.join(", ") : "none"}`);
    console.log(`   fixture ticket ids removed: ${fixtureTicketIds.join(", ") || "none"}`);
    console.log(`   fixture order ids: ${[fixtureOrderIdA, fixtureOrderIdB].filter(Boolean).join(", ") || "none"}`);

    // Verify: no throwaway row is left behind.
    const { data: afterConcerts } = await supabase
      .from("rk_concerts")
      .select("concert_id")
      .like("title", "UI-teszt koncert%");
    const { data: afterTypes } = await supabase
      .from("rk_ticket_types")
      .select("id")
      .like("name", "Teszt jegy%");
    console.log(
      `   DB check: rk_concerts "UI-teszt%" rows: ${(afterConcerts ?? []).length} (want 0); rk_ticket_types "Teszt jegy" rows: ${(afterTypes ?? []).length} (want 0)`,
    );

    // Stripe: deactivate the price, delete (or archive) the product.
    if (stripe) {
      const priceIds = new Set(stripePriceId ? [stripePriceId] : []);
      const productIds = new Set(stripeProductId ? [stripeProductId] : []);
      for await (const product of stripe.products.list({ limit: 100 })) {
        if (product.name?.startsWith(STRIPE_SWEEP_PREFIX)) productIds.add(product.id);
      }
      for (const productId of productIds) {
        const prices = await stripe.prices.list({ product: productId, limit: 100 });
        for (const price of prices.data) priceIds.add(price.id);
      }
      for (const priceId of priceIds) {
        await stripe.prices.update(priceId, { active: false });
      }
      const deleted = [];
      const archived = [];
      for (const productId of productIds) {
        try {
          await stripe.products.del(productId);
          deleted.push(productId);
        } catch (err) {
          const message = err && err.message ? String(err.message) : String(err);
          if (!message.includes("user-created prices")) throw err;
          await stripe.products.update(productId, { active: false });
          archived.push(productId);
        }
      }
      console.log(`   Stripe prices deactivated: ${[...priceIds].join(", ") || "none"}`);
      console.log(`   Stripe products deleted: ${deleted.join(", ") || "none"}; archived: ${archived.join(", ") || "none"}`);
      let activeLeft = 0;
      for await (const product of stripe.products.list({ limit: 100 })) {
        if (product.name?.startsWith(STRIPE_SWEEP_PREFIX) && product.active) activeLeft += 1;
      }
      assert.equal(activeLeft, 0, "no throwaway Stripe product may stay active");
    } else {
      console.log("   Stripe cleanup skipped: no STRIPE_SECRET_KEY");
    }

    const raw = await readLiveFileRaw();
    const lines = concertLines(raw);
    console.log(
      `   S3 file after cleanup: ${lines.length} concert lines (baseline: ${baselineLineCount ?? "n/a"})`,
    );
    if (baselineLineCount !== null) {
      assert.equal(lines.length, baselineLineCount, "the S3 line count must be back to the baseline");
    }
  } catch (err) {
    failures.push("cleanup");
    console.error(`   -> CLEANUP FAILED\n      ${err?.stack ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

await section("(pre) wait for the dev server + clean old leftovers", async () => {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const probe = await fetch(`${BASE_URL}/api/intern/koncertek`, {
        headers: { Cookie: COOKIE },
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.status > 0) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`dev server not reachable at ${BASE_URL}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const raw = await readLiveFileRaw();
  baselineLineCount = concertLines(raw).length;
  console.log(`   S3 baseline: ${baselineLineCount} concert lines`);

  const removed = await deleteThrowawayRows();
  if (removed.length) console.log(`   removed old leftovers: ${removed.join(", ")}`);
});

await section("(a) GET /intern/koncertek with cookie → 200, real concerts in the HTML", async () => {
  const withCookie = await page("/intern/koncertek");
  console.log(`   status: ${withCookie.status}`);
  assert.equal(withCookie.status, 200, "the dashboard must answer 200 with the intern cookie");

  const concerts = await admin.listUpcomingConcerts();
  const realTitles = concerts
    .filter((concert) => !concert.title.startsWith("UI-teszt"))
    .map((concert) => concert.title);
  console.log(`   real concerts in the S3 file: ${realTitles.length} (${realTitles.join(" | ")})`);
  assert.ok(realTitles.length >= 2, "expected at least two real concerts in the file");

  const clean = cleanHtml(withCookie.text);
  for (const title of realTitles) {
    assert.ok(
      clean.includes(title),
      `the dashboard HTML must contain the real concert "${title}"`,
    );
  }
  assert.ok(
    clean.includes("Számlázás (TACITo)"),
    "the health tile label „Számlázás (TACITo)” must be in the HTML",
  );
  console.log(`   found in HTML: ${realTitles.map((t) => `"${t}"`).join(", ")} + „Számlázás (TACITo)”`);

  const withoutCookie = await page("/intern/koncertek", { withCookie: false });
  const cleanGate = cleanHtml(withoutCookie.text);
  assert.equal(withoutCookie.status, 200, "the gate page must answer 200 without the cookie");
  for (const title of realTitles) {
    assert.ok(
      !cleanGate.includes(title),
      `without the cookie the HTML must NOT contain "${title}" (gate)`,
    );
  }
  console.log("   without the cookie the titles are absent (gate renders)");
});

await section("(b) create → edit → delete a throwaway concert through the UI routes", async () => {
  // create — the exact payload ConcertForm sends
  const created = await api("POST", "/api/intern/koncertek", {
    date: futureHuDate,
    time: "19:30",
    location: "Budapest",
    venue: "UI Teszt Terem",
    title: TITLE_B,
    program: ["UI teszt tétel"],
    href: "",
    href_label: "",
  });
  console.log(`   POST status: ${created.status}, body: ${JSON.stringify(created.json)}`);
  assert.equal(created.status, 200, "POST /api/intern/koncertek must answer 200");
  assert.ok(created.json?.concert?.id, "the created concert must carry an id");
  concertBId = created.json.concert.id;
  console.log(`   created concert id: ${concertBId}`);

  const afterCreate = concertLines(await readLiveFileRaw());
  console.log(`   S3 line count: ${baselineLineCount} → ${afterCreate.length} (want ${baselineLineCount + 1})`);
  assert.equal(afterCreate.length, baselineLineCount + 1, "exactly one S3 line must be added");
  assert.ok(
    afterCreate.some((line) => line.includes(TITLE_B) && line.includes(concertBId)),
    "the new S3 line must contain the title and the id",
  );

  // the list page must render it
  const listPage = await page("/intern/koncertek");
  assert.ok(
    cleanHtml(listPage.text).includes(TITLE_B),
    "the dashboard list must render the throwaway concert",
  );
  console.log("   the list page renders the throwaway concert");

  // edit
  const edited = await api("PATCH", `/api/intern/koncertek/${concertBId}`, {
    date: futureHuDate,
    time: "20:00",
    location: "Budapest",
    venue: "UI Teszt Terem",
    title: TITLE_B_EDITED,
    program: ["UI teszt tétel", "Második tétel"],
    href: "",
    href_label: "",
  });
  console.log(`   PATCH status: ${edited.status}, body: ${JSON.stringify(edited.json)}`);
  assert.equal(edited.status, 200, "PATCH must answer 200");
  assert.equal(edited.json?.concert?.title, TITLE_B_EDITED, "the title must be updated");

  const afterEdit = concertLines(await readLiveFileRaw());
  assert.equal(afterEdit.length, baselineLineCount + 1, "the edit must not change the line count");
  const editedLine = afterEdit.find((line) => line.includes(concertBId));
  assert.ok(editedLine, "the edited S3 line must still exist");
  assert.ok(editedLine.includes("20:00"), "the edited line must carry the new time");
  console.log(`   S3 line after edit: ${editedLine}`);

  // delete
  const deleted = await api("DELETE", `/api/intern/koncertek/${concertBId}`);
  console.log(`   DELETE status: ${deleted.status}, body: ${JSON.stringify(deleted.json)}`);
  assert.equal(deleted.status, 200, "DELETE must answer 200");
  assert.equal(deleted.json?.s3_removed, true, "the S3 line must be reported removed");

  const afterDelete = concertLines(await readLiveFileRaw());
  console.log(`   S3 line count: ${afterDelete.length} (baseline: ${baselineLineCount})`);
  assert.equal(afterDelete.length, baselineLineCount, "the S3 line count must be back to baseline");
});

await section("(c) publish a throwaway concert with one type, then GET the detail page", async () => {
  const created = await api("POST", "/api/intern/koncertek", {
    date: futureHuDate,
    time: "19:00",
    location: "Budapest",
    venue: "UI Teszt Terem",
    title: TITLE_C,
    program: [],
    href: "",
    href_label: "",
  });
  assert.equal(created.status, 200, "POST for the publishing fixture must answer 200");
  concertCId = created.json.concert.id;
  console.log(`   concert id: ${concertCId}, status: ${created.json.ticketing?.status}`);

  // one ticket type — the exact payload TicketTypeEditor sends for a new row
  const types = await api("PUT", `/api/intern/koncertek/${concertCId}/ticket-types`, {
    types: [{ name: TYPE_NAME, kind: "standard", price_huf: 1500, capacity: 100, active: true, sort: 0 }],
  });
  console.log(`   PUT ticket-types status: ${types.status}`);
  assert.equal(types.status, 200, "PUT ticket-types must answer 200");
  const type = types.json?.types?.[0];
  assert.ok(type?.id, "the type must carry an id");
  assert.ok(type?.stripe_price_id, "the type must carry a Stripe price id (no Checkout Session was created)");
  concertCTypeId = type.id;
  stripePriceId = type.stripe_price_id;
  console.log(`   type: ${JSON.stringify(type)}`);

  if (stripe) {
    const price = await stripe.prices.retrieve(stripePriceId);
    stripeProductId = typeof price.product === "string" ? price.product : price.product?.id ?? null;
    console.log(`   Stripe price: ${stripePriceId}, product: ${stripeProductId} (inert — never used in a session)`);
  }

  const published = await api("POST", `/api/intern/koncertek/${concertCId}/publish`);
  console.log(`   publish status: ${published.status}, body: ${JSON.stringify(published.json)}`);
  assert.equal(published.status, 200, "publish must answer 200");
  assert.equal(published.json?.concert?.status, "on_sale", "the concert must be on_sale");

  // the detail page: pill + price in the rendered HTML
  const detail = await page(`/intern/koncertek/${concertCId}`);
  console.log(`   GET /intern/koncertek/${concertCId} status: ${detail.status}`);
  assert.equal(detail.status, 200, "the detail page must answer 200");
  const clean = cleanHtml(detail.text);
  assert.ok(clean.includes(TITLE_C), "the detail page must render the concert title");
  const pill = clean.includes("Árusítás") ? "Árusítás" : null;
  assert.ok(pill, "the rendered detail page must show the „Árusítás” status pill");
  const priceMatch = clean.match(/Teszt jegy · 1 500 Ft/);
  assert.ok(priceMatch, "the rendered detail page must show the type price „1 500 Ft”");
  console.log(`   rendered status pill: "${pill}"`);
  console.log(`   rendered price line: "${priceMatch[0]}"`);

  // the list page shows the pill too
  const listPage = await page("/intern/koncertek");
  assert.ok(cleanHtml(listPage.text).includes("Árusítás"), "the list page must show the „Árusítás” pill");
  console.log("   the list page shows the „Árusítás” pill for the published concert");
});

await section("(d) check-in: fake paid order tickets → Érvényes / Már beolvasva / Másik koncertre", async () => {
  assert.ok(concertCId, "(c) must have produced the publishing concert");
  assert.ok(concertCTypeId, "(c) must have produced the ticket type");

  // Second throwaway concert — the wrong-concert ticket belongs to this one.
  const created = await api("POST", "/api/intern/koncertek", {
    date: futureHuDate,
    time: "19:00",
    location: "Budapest",
    venue: "UI Teszt Terem",
    title: TITLE_D,
    program: [],
    href: "",
    href_label: "",
  });
  assert.equal(created.status, 200, "POST for the other-concert fixture must answer 200");
  concertDId = created.json.concert.id;
  console.log(`   other concert id: ${concertDId}`);

  // Fake paid orders + tickets, inserted directly into the DB.
  codeX = ticketCode.makeCode();
  codeY = ticketCode.makeCode();
  fixtureOrderIdA = randomUUID();
  fixtureOrderIdB = randomUUID();
  const insertOrder = async (id, concertId) => {
    const { error } = await supabase.from("rk_orders").insert({
      id,
      concert_id: concertId,
      buyer_name: "Teszt Vásárló",
      buyer_email: "teszt@rezkorut-pelda.hu",
      amount_huf: 1500,
      currency: "HUF",
      stripe_session_id: `cs_ui_checkin_${id}`,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
    if (error) throw new Error(`rk_orders insert failed: ${error.message}`);
  };
  const insertTicket = async (orderId, concertId, code, typeName, typeId) => {
    const { data, error } = await supabase
      .from("rk_tickets")
      .insert({
        order_id: orderId,
        concert_id: concertId,
        ticket_type_id: typeId,
        ticket_type_name: typeName,
        price_huf: 1500,
        code,
        status: "valid",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`rk_tickets insert failed: ${error?.message ?? "no row"}`);
    fixtureTicketIds.push(data.id);
  };
  await insertOrder(fixtureOrderIdA, concertCId);
  await insertTicket(fixtureOrderIdA, concertCId, codeX, TYPE_NAME, concertCTypeId);
  await insertOrder(fixtureOrderIdB, concertDId);
  await insertTicket(fixtureOrderIdB, concertDId, codeY, "Másik jegy", null);
  console.log(`   fixture orders: ${fixtureOrderIdA} (concert C), ${fixtureOrderIdB} (concert D)`);
  console.log(`   fixture tickets: code ${codeX} (C), ${codeY} (D)`);

  // 1) valid — with a dirty input: lowercase + dashes + spaces
  const dirty = `${codeX.slice(0, 4).toLowerCase()}-${codeX.slice(4, 7).toLowerCase()} ${codeX.slice(7)}`;
  const first = await api("POST", "/api/intern/checkin", { concert_id: concertCId, code: dirty });
  console.log(`   POST checkin(dirty "${dirty}") status: ${first.status}`);
  console.log(`   body: ${JSON.stringify(first.json)}`);
  assert.equal(first.status, 200, "checkin must answer 200");
  assert.equal(first.json?.result, "valid", `dirty input must scan as valid (got ${first.json?.result})`);
  assert.equal(first.json?.ticket?.ticket_type_name, TYPE_NAME, "the valid scan must carry the ticket type");
  assert.equal(first.json?.ticket?.buyer_name, "Teszt Vásárló", "the valid scan must carry the buyer name");
  assert.equal(first.json?.counts?.used, 1, "used counter must be 1");
  assert.equal(first.json?.counts?.sold, 1, "sold counter must be 1");
  console.log('   -> "Érvényes jegy" (normalized input, type + buyer + counters checked)');

  // 2) same code again → used
  const second = await api("POST", "/api/intern/checkin", { concert_id: concertCId, code: codeX });
  console.log(`   POST checkin(again) status: ${second.status}, body: ${JSON.stringify(second.json)}`);
  assert.equal(second.status, 200, "the second scan must answer 200");
  assert.equal(second.json?.result, "used", `the second scan must be "used" (got ${second.json?.result})`);
  assert.ok(second.json?.ticket?.used_at, "the used scan must carry used_at");
  console.log('   -> "Már beolvasva"');

  // 3) code from the other concert → wrong_concert
  const third = await api("POST", "/api/intern/checkin", { concert_id: concertCId, code: codeY });
  console.log(`   POST checkin(other concert code) status: ${third.status}, body: ${JSON.stringify(third.json)}`);
  assert.equal(third.status, 200, "the wrong-concert scan must answer 200");
  assert.equal(third.json?.result, "wrong_concert", `expected wrong_concert (got ${third.json?.result})`);
  console.log('   -> "Másik koncertre szól"');

  // 4) unknown code
  const unknownCode = "ZZZZZZZZZZ";
  const fourth = await api("POST", "/api/intern/checkin", { concert_id: concertCId, code: unknownCode });
  console.log(`   POST checkin(unknown) status: ${fourth.status}, body: ${JSON.stringify(fourth.json)}`);
  assert.equal(fourth.status, 200, "the unknown scan must answer 200");
  assert.equal(fourth.json?.result, "unknown", `expected unknown (got ${fourth.json?.result})`);
  console.log('   -> "Ismeretlen kód"');

  // 5) the check-in screen renders for the concert
  const doorPage = await page(`/intern/koncertek/${concertCId}/beleptetes`);
  console.log(`   GET beleptetes status: ${doorPage.status}`);
  assert.equal(doorPage.status, 200, "the check-in screen must answer 200");
  const doorClean = cleanHtml(doorPage.text);
  assert.ok(doorClean.includes("Beléptetés"), "the check-in screen must render its title");
  assert.ok(doorClean.includes(TITLE_C), "the check-in screen must render the concert title");
  assert.ok(doorClean.includes("1 / 1 eladott"), "the used/sold counter must render 1 / 1");
  console.log('   the door screen renders with the "1 / 1 eladott" counter');
});

await section("(e) /intern lists the new „Koncertek” card, placed first", async () => {
  const hub = await page("/intern");
  console.log(`   GET /intern status: ${hub.status}`);
  assert.equal(hub.status, 200, "/intern must answer 200");
  const clean = cleanHtml(hub.text);
  assert.ok(clean.includes("Koncertek"), "the hub must list the „Koncertek” card");
  assert.ok(
    clean.includes("Jegyek, eladások, beléptetés"),
    "the hub card must carry the „Jegyek, eladások, beléptetés” description",
  );
  const koncertekAt = clean.indexOf("Jegyek, eladások, beléptetés");
  const kanbanAt = clean.indexOf("Feladatkezelő");
  assert.ok(kanbanAt > 0, "the Kanban card must be present for the ordering check");
  assert.ok(koncertekAt < kanbanAt, "the „Koncertek” card must be placed before Kanban");
  console.log(`   card order ok: Koncertek at ${koncertekAt} < Kanban card at ${kanbanAt}`);
});

await cleanup();

console.log("\n==============================");
if (failures.length === 0) {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
} else {
  for (const name of failures) console.log(`FAILED: ${name}`);
  process.exit(1);
}
