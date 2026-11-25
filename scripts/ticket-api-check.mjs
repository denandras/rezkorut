// Verification harness for card 02 (Ticketing data layer + intern concert API).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/ticket-api-check.mjs
//
// Requires node >= 22.18 (native TypeScript type-stripping) — same style as
// card 01's scripts/concert-admin-check.mjs. The script drives the real API
// with the intern cookie, reads the live S3 file back directly, reads
// rk_ticket_types back through the service role key, and talks to Stripe only
// to list the prices/products it created (creating a product/price is inert —
// NO Checkout Session is ever created here).
//
// Proofs (per the card):
//   a) unauthenticated GET → 401
//   b) GET with cookie → 2 concerts, ticketing: null
//   c) POST throwaway "Teszt – törlendő" (future date) → 200 + rk-... id, and
//      the id appears in the live S3 file (raw line printed)
//   d) PATCH the title → S3 line updated, every other line byte-identical
//      (line counts before/after printed)
//   d2) PUT ticket types validation rejects bad payloads (400s)
//   d3) publish with zero ticket types → 400 (validation gate)
//   e) PUT two ticket types → rk_ticket_types rows with non-null
//      stripe_price_id (rows printed, from the DB, not just the API response)
//   f) publish → status on_sale
//   g) DELETE → S3 line gone, DB row closed
// Cleanup: the script itself removes the throwaway S3 line and the throwaway
// DB rows; only the Stripe products/prices stay (ids printed for archiving).
// If STRIPE_SECRET_KEY is missing, sections e/f are SKIPPED with a clear
// notice and the script exits 2 after cleanup.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
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
const stripeMode = STRIPE_KEY
  ? STRIPE_KEY.startsWith("sk_live_") ? "live" : "test"
  : null;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`Stripe key mode: ${stripeMode ?? "MISSING (sections e/f will be skipped)"}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" }) : null;

// ---------------------------------------------------------------------------
// "@/" alias hook + live S3 concert-admin import (same as card 01's harness)
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

// ---------------------------------------------------------------------------
// Section runner
// ---------------------------------------------------------------------------

const failures = [];
let currentSection = "";
async function section(name, fn) {
  currentSection = name;
  console.log(`\n== ${name}`);
  try {
    await fn();
    console.log("   -> ok");
  } catch (err) {
    failures.push(name);
    console.error(`   -> FAIL\n      ${err?.stack ?? err}`);
  }
}

const THROWS = [];

// Throwaway concert data
const HU_MONTHS = ["január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december"];
const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
const futureHuDate = `${future.getFullYear()}. ${HU_MONTHS[future.getMonth()]} ${future.getDate()}.`;
const futureIsoDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
const THROWAWAY_TITLE = "Teszt – törlendő";
const THROWAWAY_TITLE2 = "Teszt – törlendő (javítva)";

let throwawayId = null;
let baselineRaw = null;
let baselineConcertCount = null;
let createdTypes = [];

console.log(`Throwaway concert: title "${THROWAWAY_TITLE}", date ${futureHuDate} (${futureIsoDate})`);

// ---------------------------------------------------------------------------
// Cleanup (idempotent; runs even when a section fails)
// ---------------------------------------------------------------------------

async function dbHasOrders(concertId) {
  const { data, error } = await supabase
    .from("rk_orders")
    .select("id")
    .eq("concert_id", concertId);
  if (error) throw new Error(`rk_orders check failed: ${error.message}`);
  return (data ?? []).length;
}

async function deleteThrowawayRows(concertId) {
  const ids = new Set(concertId ? [concertId] : []);
  // Any older throwaway leftovers (crashed run): same title prefix.
  const { data: leftovers, error } = await supabase
    .from("rk_concerts")
    .select("concert_id,title")
    .like("title", "Teszt – törlendő%");
  if (error) throw new Error(`rk_concerts select failed: ${error.message}`);
  for (const row of leftovers ?? []) ids.add(row.concert_id);

  const removed = [];
  for (const id of ids) {
    const orders = await dbHasOrders(id);
    if (orders > 0) {
      console.error(`   REFUSING to delete rk_concerts ${id}: it has ${orders} order(s)`);
      continue;
    }
    const del = await supabase.from("rk_concerts").delete().eq("concert_id", id);
    if (del.error) throw new Error(`rk_concerts delete failed: ${del.error.message}`);
    removed.push(id);
  }
  return removed;
}

async function cleanup() {
  console.log("\n== cleanup (idempotent)");
  try {
    // S3: remove the throwaway line if it is still there.
    const concerts = await admin.listUpcomingConcerts();
    const stale = concerts.filter(
      (concert) => concert.title === THROWAWAY_TITLE || concert.title === THROWAWAY_TITLE2,
    );
    for (const concert of stale) {
      if (!concert.id) {
        console.error(`   REFUSING S3 cleanup: leftover concert without id: ${concert.title}`);
        continue;
      }
      await admin.deleteConcert(concert.id);
      console.log(`   S3 line removed: ${concert.id}`);
    }
    if (!stale.length) console.log("   S3: no throwaway line present");

    const removed = await deleteThrowawayRows(throwawayId);
    console.log(`   DB rows deleted: ${removed.length ? removed.join(", ") : "none"}`);

    // Verify: the row(s) are gone, ticket types cascaded away.
    if (throwawayId) {
      const { data: after } = await supabase
        .from("rk_concerts")
        .select("concert_id")
        .eq("concert_id", throwawayId);
      const { data: typesAfter } = await supabase
        .from("rk_ticket_types")
        .select("id")
        .eq("concert_id", throwawayId);
      console.log(
        `   DB check: rk_concerts rows for ${throwawayId}: ${(after ?? []).length} (want 0); rk_ticket_types rows: ${(typesAfter ?? []).length} (want 0)`,
      );
    }
    const stat = await admin.statUpcomingFile();
    console.log(
      `   S3 file after cleanup: LastModified ${stat.lastModified}, ${stat.sizeBytes} bytes (baseline: ${baselineRaw !== null ? `${baselineConcertCount} concert lines` : "n/a"})`,
    );
  } catch (err) {
    failures.push("cleanup");
    console.error(`   -> CLEANUP FAILED\n      ${err?.stack ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

await section("(0) lib/ticket-code unit checks (no server needed)", async () => {
  const codes = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = ticketCode.makeCode();
    assert.match(code, /^[0-9A-Z]{10}$/, `code ${code} must be 10 Crockford base32 chars`);
    assert.ok(!/[ILOU]/.test(code), `code ${code} must not contain I/L/O/U`);
    codes.add(code);
  }
  assert.equal(codes.size, 1000, "1000 codes must be unique (32^10 space, collision impossible)");
  const sample = ticketCode.makeCode();
  assert.equal(ticketCode.isValidCode(sample), true, "a generated code must validate");
  assert.equal(ticketCode.isValidCode(sample.toLowerCase()), true, "validation is case-insensitive");
  assert.equal(ticketCode.isValidCode(` ${sample} `), true, "validation trims");
  assert.equal(ticketCode.isValidCode(sample.slice(0, 9)), false, "9 chars must fail");
  assert.equal(ticketCode.isValidCode(`${sample}A`), false, "11 chars must fail");
  assert.equal(ticketCode.isValidCode(`${sample.slice(0, 9)}I`), false, "I must fail");
  assert.equal(ticketCode.isValidCode(`${sample.slice(0, 9)}L`), false, "L must fail");
  assert.equal(ticketCode.isValidCode(`${sample.slice(0, 9)}O`), false, "O must fail");
  assert.equal(ticketCode.isValidCode(`${sample.slice(0, 9)}U`), false, "U must fail");
  assert.equal(ticketCode.isValidCode(""), false, "empty must fail");
  assert.equal(ticketCode.isValidCode(123), false, "non-string must fail");
  console.log(`   sample code: ${sample} (makeCode/isValidCode round-trip ok, 1000 unique codes)`);
});

await section("(pre) wait for the dev server + clean old leftovers", async () => {
  // The dev server compiles routes on first hit — poll the API until it answers.
  const deadline = Date.now() + 120_000;
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

  const removed = await deleteThrowawayRows(null);
  if (removed.length) console.log(`   removed old DB rows: ${removed.join(", ")}`);
});

await section("(a) unauthenticated GET → 401", async () => {
  const res = await api("GET", "/api/intern/koncertek", undefined, { withCookie: false });
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 401, "must be 401 without the intern cookie");
  assert.ok(res.json?.error, "401 body must carry an error message");
});

await section("(b) GET with cookie → 2 concerts, ticketing null", async () => {
  const res = await api("GET", "/api/intern/koncertek");
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  const concerts = res.json?.concerts;
  assert.ok(Array.isArray(concerts), "response must carry concerts[]");
  console.log(`   status: 200, concerts: ${concerts.length}`);
  for (const concert of concerts) {
    console.log(
      `   - ${concert.id} | ${concert.date} | ${concert.title} | ticketing: ${JSON.stringify(concert.ticketing)}`,
    );
  }
  assert.equal(concerts.length, 2, "the live file must parse to exactly 2 concerts today");
  for (const concert of concerts) {
    assert.ok(concert.id, "every concert must carry an id (assigned or derived)");
    assert.equal(concert.ticketing, null, "no rk_concerts row exists yet — ticketing must be null");
  }
  baselineRaw = await readLiveFileRaw();
  baselineConcertCount = concertLines(baselineRaw).length;
  console.log(`   baseline S3 file: ${baselineConcertCount} concert lines, ${baselineRaw.split(/\r?\n/).length} total lines`);
});

await section("(c) POST throwaway concert → 200 + rk-... id, line in live S3 file", async () => {
  const res = await api("POST", "/api/intern/koncertek", {
    date: futureIsoDate, // ISO on purpose — the API normalizes to the file's HU format
    time: "19:00",
    location: "Teszt város",
    venue: "Teszt terem",
    title: THROWAWAY_TITLE,
    program: ["Teszt szerző: Teszt mű"],
  });
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, `POST failed: ${JSON.stringify(res.json)}`);
  throwawayId = res.json?.concert?.id;
  assert.ok(throwawayId, "POST must return the created concert with an id");
  assert.match(throwawayId, /^rk-[a-z0-9-]+$/, "id must look like rk-...");
  assert.equal(res.json?.ticketing?.status, "draft", "new concert mirror must be draft");

  const raw = await readLiveFileRaw();
  const lines = concertLines(raw);
  const line = lines.find((l) => l.includes(`id:${throwawayId}`));
  console.log(`   live S3 line (${lines.length} concert lines now):`);
  console.log(`   ${line}`);
  assert.ok(line, `the created id must appear in the live S3 file`);
  assert.ok(line.includes(THROWAWAY_TITLE), "the line must carry the throwaway title");
  assert.ok(line.includes(futureHuDate), `the line must carry the future date ${futureHuDate}`);
});

await section("(d) PATCH title → S3 line updated, other lines byte-identical", async () => {
  const beforeRaw = await readLiveFileRaw();
  const beforeLines = beforeRaw.split(/\r?\n/);

  const res = await api("PATCH", `/api/intern/koncertek/${throwawayId}`, {
    title: THROWAWAY_TITLE2,
  });
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, `PATCH failed: ${JSON.stringify(res.json)}`);
  assert.equal(res.json?.concert?.title, THROWAWAY_TITLE2, "PATCH must return the updated title");

  const afterRaw = await readLiveFileRaw();
  const afterLines = afterRaw.split(/\r?\n/);
  const concertBefore = concertLines(beforeRaw);
  const concertAfter = concertLines(afterRaw);
  console.log(`   line counts — total: ${beforeLines.length} → ${afterLines.length}; concert lines: ${concertBefore.length} → ${concertAfter.length}`);
  assert.equal(afterLines.length, beforeLines.length, "total line count must not change");
  assert.equal(concertAfter.length, concertBefore.length, "concert line count must not change");

  let patched = -1;
  let otherDiff = 0;
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] === afterLines[i]) continue;
    if (afterLines[i].includes(`id:${throwawayId}`)) {
      patched = i;
    } else {
      otherDiff++;
    }
  }
  console.log(`   patched line index: ${patched}`);
  console.log(`   ${patched >= 0 ? afterLines[patched] : "(line not found!)"}`);
  assert.ok(patched >= 0, "exactly the throwaway line must change");
  assert.ok(afterLines[patched].includes(THROWAWAY_TITLE2), "patched line must carry the new title");
  assert.equal(otherDiff, 0, "no other line may change");
});

await section("(d2) PUT ticket types validation rejects bad payloads (400s)", async () => {
  const cases = [
    {
      label: "empty types",
      body: { types: [] },
    },
    {
      label: "price below 200",
      body: { types: [{ name: "Túl olcsó", kind: "standard", price_huf: 199, active: true, sort: 0 }] },
    },
    {
      label: "two early_bird types",
      body: {
        types: [
          { name: "Korai egy", kind: "early_bird", price_huf: 2000, active: true, sort: 0 },
          { name: "Korai ketto", kind: "early_bird", price_huf: 2100, active: true, sort: 1 },
        ],
      },
    },
    {
      label: "bad kind",
      body: { types: [{ name: "Vip", kind: "vip", price_huf: 5000, active: true, sort: 0 }] },
    },
    {
      label: "capacity 0",
      body: { types: [{ name: "Nulla", kind: "standard", price_huf: 2000, capacity: 0, active: true, sort: 0 }] },
    },
    {
      label: "61-char name",
      body: {
        types: [{ name: "A".repeat(61), kind: "standard", price_huf: 2000, active: true, sort: 0 }],
      },
    },
    {
      label: "unknown type id",
      body: {
        types: [
          {
            id: "00000000-0000-4000-8000-000000000000",
            name: "Idegen",
            kind: "standard",
            price_huf: 2000,
            active: true,
            sort: 0,
          },
        ],
      },
    },
  ];
  for (const testCase of cases) {
    const res = await api("PUT", `/api/intern/koncertek/${throwawayId}/ticket-types`, testCase.body);
    console.log(`   ${testCase.label}: ${res.status} ${JSON.stringify(res.json)}`);
    assert.equal(res.status, 400, `${testCase.label} must be rejected with 400`);
    assert.ok(res.json?.error, `${testCase.label} must carry an error message`);
  }
  // Nothing may have been written by the rejected payloads.
  const { data } = await supabase
    .from("rk_ticket_types")
    .select("id")
    .eq("concert_id", throwawayId);
  assert.equal((data ?? []).length, 0, "no ticket type rows may exist after 400 rejections");
});

await section("(d3) publish with zero ticket types → 400 (validation gate)", async () => {
  const res = await api("POST", `/api/intern/koncertek/${throwawayId}/publish`, {});
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 400, "publish must be rejected while the concert has no ticket types");
  assert.ok(res.json?.error, "the rejection must carry an error message");
});

if (!stripe) {
  console.log("\n== (e) PUT ticket types → SKIPPED: STRIPE_SECRET_KEY is missing");
  console.log("== (f) publish → SKIPPED: STRIPE_SECRET_KEY is missing");
  console.log("   The Stripe price sync cannot be proven without the key. Everything else ran.");
  THROWS.push("e/f skipped: STRIPE_SECRET_KEY missing");
} else {
  await section("(e) PUT two ticket types → rk_ticket_types rows with stripe_price_id", async () => {
    const payload = {
      types: [
        { name: "Korai madár", kind: "early_bird", price_huf: 2000, capacity: 5, active: true, sort: 0 },
        { name: "Normál", kind: "standard", price_huf: 3000, capacity: 10, active: true, sort: 1 },
      ],
    };
    const res = await api("PUT", `/api/intern/koncertek/${throwawayId}/ticket-types`, payload);
    console.log(`   status: ${res.status}`);
    console.log(`   body: ${JSON.stringify(res.json)}`);
    assert.equal(res.status, 200, `PUT failed: ${JSON.stringify(res.json)}`);
    assert.equal(res.json?.types?.length, 2, "two types must come back");
    for (const type of res.json.types) {
      assert.ok(type.stripe_price_id, `type ${type.name} must have a stripe_price_id`);
      assert.ok(type.stripe_lookup_key?.startsWith(`rk:${throwawayId}:`), "lookup key must be rk:<concert_id>:…");
    }

    // Read the rows back from the DB itself.
    const { data, error } = await supabase
      .from("rk_ticket_types")
      .select("id,name,kind,price_huf,capacity,sold,active,sort,stripe_price_id,stripe_lookup_key")
      .eq("concert_id", throwawayId)
      .order("sort");
    if (error) throw new Error(`rk_ticket_types read-back failed: ${error.message}`);
    console.log(`   rk_ticket_types rows read back from Supabase (${data.length}):`);
    createdTypes = [];
    for (const row of data) {
      console.log(`   ${JSON.stringify(row)}`);
      assert.ok(row.stripe_price_id, `DB row ${row.name} must have stripe_price_id`);
      createdTypes.push(row);
    }
    assert.equal(data.length, 2, "exactly two rows must exist");
  });

  await section("(f) publish → status on_sale", async () => {
    const res = await api("POST", `/api/intern/koncertek/${throwawayId}/publish`, {});
    console.log(`   status: ${res.status}`);
    console.log(`   body: ${JSON.stringify(res.json)}`);
    assert.equal(res.status, 200, `publish failed: ${JSON.stringify(res.json)}`);
    assert.equal(res.json?.concert?.status, "on_sale", "published concert must be on_sale");

    const { data } = await supabase
      .from("rk_concerts")
      .select("concert_id,status")
      .eq("concert_id", throwawayId)
      .single();
    console.log(`   DB row status: ${data?.status}`);
    assert.equal(data?.status, "on_sale", "the DB row must be on_sale");
  });
}

await section("(extra) GET orders of the throwaway concert → empty list", async () => {
  const res = await api("GET", `/api/intern/koncertek/${throwawayId}/orders`);
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, "orders route must answer 200 while the concert exists");
  assert.ok(Array.isArray(res.json?.orders), "orders must be an array");
  assert.equal(res.json.orders.length, 0, "the throwaway concert must have no orders");
});

await section("(extra) GET tacito/status → healthy zero-state tile", async () => {
  const res = await api("GET", "/api/intern/tacito/status");
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, "the health endpoint must never answer 5xx");
  assert.equal(res.json?.ok, true, "with the DB configured the tile must be ok");
  assert.deepEqual(
    res.json?.counts,
    { issued_total: 0, pending_tickets: 0, error_tickets: 0 },
    "no tickets exist yet — all counts must be zero",
  );
  assert.deepEqual(res.json?.last_errors, [], "no errors yet");
});

await section("(g) DELETE throwaway → S3 line gone, DB row closed", async () => {
  const res = await api("DELETE", `/api/intern/koncertek/${throwawayId}`);
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, `DELETE failed: ${JSON.stringify(res.json)}`);
  assert.equal(res.json?.s3_removed, true, "the S3 line must have been removed");
  assert.equal(res.json?.concert?.status, "closed", "the DB row must be closed");
  assert.equal(res.json?.orders_count, 0, "no orders may exist for the throwaway");

  const raw = await readLiveFileRaw();
  assert.ok(!raw.includes(`id:${throwawayId}`), "the id must be gone from the live S3 file");
  const afterCount = concertLines(raw).length;
  console.log(`   live S3 file: ${afterCount} concert lines (baseline ${baselineConcertCount})`);
  assert.equal(afterCount, baselineConcertCount, "the concert line count must be back to baseline");

  const { data } = await supabase
    .from("rk_concerts")
    .select("concert_id,status")
    .eq("concert_id", throwawayId)
    .single();
  console.log(`   DB row after DELETE: ${JSON.stringify(data)}`);
  assert.equal(data?.status, "closed", "the DB row must read closed");
});

await cleanup();

// ---------------------------------------------------------------------------
// Stripe report (products/prices stay — the owner archives them)
// ---------------------------------------------------------------------------

if (stripe && createdTypes.length) {
  console.log("\n== Stripe prices/products created (archive these in the dashboard):");
  for (const type of createdTypes) {
    const price = await stripe.prices.retrieve(type.stripe_price_id);
    const productId = typeof price.product === "string" ? price.product : price.product?.id;
    console.log(
      `   type "${type.name}": price ${price.id} (product ${productId}, ${price.unit_amount} fillér = ${price.unit_amount / 100} Ft, ${price.currency}, active=${price.active}, lookup_key=${price.lookup_key})`,
    );
  }
  console.log("   (products/prices are inert — no Checkout Session was created, no money moved)");
}

console.log("\n==============================");
if (failures.length === 0 && THROWS.length === 0) {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
} else {
  for (const name of failures) console.log(`FAILED: ${name}`);
  for (const note of THROWS) console.log(`NOTE: ${note}`);
  console.log(failures.length ? "CHECKS FAILED" : "CHECKS PASSED WITH EXCEPTIONS");
  process.exit(failures.length ? 1 : 2);
}
