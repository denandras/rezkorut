// Verification harness for card 08 (/j/[code] ticket page + language sweep).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/card08-check.mjs setup    # insert test concert + paid order + valid ticket
//   node scripts/card08-check.mjs check    # page checks + door-person check-in flow
//   node scripts/card08-check.mjs cleanup  # delete every inserted row, verify empty
//
// Same style as scripts/ticket-api-check.mjs: .env.local is parsed with the
// quote-stripping loader, the service-role client talks to rk_* directly, and
// every assertion prints what it saw. The rows carry a throwaway concert id
// (rk-2026-12-05-card08-teszt) and a throwaway ticket code (CARD08TEST);
// cleanup deletes by those exact keys and re-SELECTs to prove the tables are
// back to their pre-test state (supabase-js delete can lie with a truthy
// error object — only a re-read counts).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const BASE_URL = process.env.CARD08_BASE_URL || "http://localhost:3001";
const COOKIE = "rezkorut-intern-auth=1";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const CONCERT_ID = "rk-2026-12-05-card08-teszt";
const CODE = "CARD08TEST";
const BUYER_NAME = "Card08 Teszt Vásárló";
const BUYER_EMAIL = "card08.teszt@example.com";

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function main() {
  const phase = process.argv[2];
  if (!["setup", "check", "cleanup"].includes(phase)) {
    console.error("usage: node scripts/card08-check.mjs <setup|check|cleanup>");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (phase === "setup") return setup(db);
  if (phase === "check") return check(db);
  return cleanup(db);
}

async function deleteTestRows(db) {
  // Idempotent: leftovers of a previous run are removed by exact key first.
  await db.from("rk_tickets").delete().eq("code", CODE);
  await db.from("rk_orders").delete().eq("buyer_email", BUYER_EMAIL).eq("concert_id", CONCERT_ID);
  await db.from("rk_concerts").delete().eq("concert_id", CONCERT_ID);
}

async function setup(db) {
  await deleteTestRows(db);

  const concert = {
    concert_id: CONCERT_ID,
    title: "Card 08 tesztkoncert (törlendő)",
    event_date: "2026-12-05",
    event_time: "19:30",
    location: "Tesztváros",
    venue: "Teszt terem",
    status: "on_sale",
  };
  const { data: concertRow, error: concertError } = await db
    .from("rk_concerts")
    .insert(concert)
    .select("concert_id")
    .single();
  assert.ok(!concertError && concertRow, `rk_concerts insert failed: ${concertError?.message}`);

  const order = {
    concert_id: CONCERT_ID,
    buyer_name: BUYER_NAME,
    buyer_email: BUYER_EMAIL,
    address_country: "HU",
    address_postal: "1133",
    address_city: "Budapest",
    address_street: "Teszt utca 1.",
    amount_huf: 1000,
    currency: "HUF",
    status: "paid",
    paid_at: new Date().toISOString(),
  };
  const { data: orderRow, error: orderError } = await db
    .from("rk_orders")
    .insert(order)
    .select("id")
    .single();
  assert.ok(!orderError && orderRow, `rk_orders insert failed: ${orderError?.message}`);

  const { data: ticketRow, error: ticketError } = await db
    .from("rk_tickets")
    .insert({
      order_id: orderRow.id,
      concert_id: CONCERT_ID,
      ticket_type_name: "Teljes árú jegy",
      price_huf: 1000,
      code: CODE,
      status: "valid",
    })
    .select("id,code,status")
    .single();
  assert.ok(!ticketError && ticketRow, `rk_tickets insert failed: ${ticketError?.message}`);

  console.log("setup OK — inserted rows:");
  console.log("  rk_concerts:", concertRow.concert_id);
  console.log("  rk_orders:  ", orderRow.id);
  console.log("  rk_tickets: ", ticketRow.id, "code", ticketRow.code, "status", ticketRow.status);
}

/** Ticket row by code, printed as the before/after evidence. */
async function ticketRow(db) {
  const { data, error } = await db
    .from("rk_tickets")
    .select("id,code,status,used_at,ticket_type_name")
    .eq("code", CODE)
    .maybeSingle();
  assert.ok(!error, `rk_tickets read failed: ${error?.message}`);
  return data;
}

/** SSR separates adjacent text nodes with <!-- --> — strip before asserting. */
function visible(html) {
  return html.replace(/<!-- -->/g, "");
}

async function check(db) {
  // Reset the ticket to `valid` so this phase is self-contained even if a
  // browser test admitted it moments ago.
  const { error: resetError } = await db
    .from("rk_tickets")
    .update({ status: "valid", used_at: null })
    .eq("code", CODE);
  assert.ok(!resetError, `rk_tickets reset failed: ${resetError?.message}`);

  const before = await ticketRow(db);
  console.log("ticket row BEFORE:", JSON.stringify(before));

  // (a) buyer view, no cookie — facts + state word + door line, no button,
  //     no buyer data.
  const buyerRes = await fetch(`${BASE_URL}/j/${CODE}`);
  const buyerHtml = visible(await buyerRes.text());
  console.log(`(a) GET /j/${CODE} without cookie → HTTP ${buyerRes.status}`);
  assert.equal(buyerRes.status, 200, "buyer view must be HTTP 200");
  for (const part of [
    "Card 08 tesztkoncert (törlendő)",
    "2026. december 5.",
    "19:30",
    "Teszt terem",
    "Teljes árú jegy",
    CODE,
    "Érvényes",
    "A jegyet a koncertre belépéskor, a QR-kód alapján ellenőrzik.",
  ]) {
    assert.ok(buyerHtml.includes(part), `buyer view must contain ${JSON.stringify(part)}`);
  }
  assert.ok(!buyerHtml.includes("Beléptetés"), "no Beléptetés button without the intern cookie");
  assert.ok(!buyerHtml.includes(BUYER_EMAIL), "buyer e-mail must never appear on /j/<code>");
  assert.ok(!buyerHtml.includes(BUYER_NAME), "buyer name must never appear on /j/<code>");
  assert.ok(!buyerHtml.includes("card08.teszt"), "no buyer datum may appear on /j/<code>");
  console.log("    facts + state + door line present; no Beléptetés button; no buyer data ✓");

  // (b) unknown code — calm page, HTTP 200.
  const unknownRes = await fetch(`${BASE_URL}/j/BADCODE`);
  const unknownHtml = visible(await unknownRes.text());
  console.log(`(b) GET /j/BADCODE → HTTP ${unknownRes.status}`);
  assert.equal(unknownRes.status, 200, "unknown code must be HTTP 200");
  assert.ok(
    unknownHtml.includes("Ilyen kóddal nem találunk jegyet."),
    "unknown code must render the calm sentence",
  );
  assert.ok(!unknownHtml.includes(CODE), "unknown-code page must not leak a real code");
  assert.ok(!unknownHtml.includes("Not Found"), "no 404 marker");
  console.log("    calm page rendered, no trace of the format or other codes ✓");

  // (c) door person view, with cookie — the Beléptetés button exists.
  const doorRes = await fetch(`${BASE_URL}/j/${CODE}`, { headers: { cookie: COOKIE } });
  const doorHtml = visible(await doorRes.text());
  console.log(`(c) GET /j/${CODE} with intern cookie → HTTP ${doorRes.status}`);
  assert.equal(doorRes.status, 200);
  assert.ok(doorHtml.includes("Beléptetés"), "door view must contain the Beléptetés button");
  console.log("    „Beléptetés” button present ✓");

  // (d) the door person's POST — the existing intern check-in route.
  const apiRes = await fetch(`${BASE_URL}/api/intern/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: COOKIE },
    body: JSON.stringify({ concert_id: CONCERT_ID, code: CODE }),
  });
  const apiData = await apiRes.json();
  console.log(`(d) POST /api/intern/checkin → HTTP ${apiRes.status}`);
  console.log("    API result:", JSON.stringify(apiData));
  assert.equal(apiRes.status, 200);
  assert.equal(apiData.result, "valid", "fresh valid ticket must admit");
  assert.ok(apiData.ticket?.used_at, "the valid answer now carries the door time");

  const after = await ticketRow(db);
  console.log("ticket row AFTER: ", JSON.stringify(after));
  assert.equal(after.status, "used", "ticket must be used after the check-in");
  assert.ok(after.used_at, "used_at must be set");

  // (e) the page re-rendered with the cookie now shows the used state.
  const usedRes = await fetch(`${BASE_URL}/j/${CODE}`, { headers: { cookie: COOKIE } });
  const usedHtml = visible(await usedRes.text());
  console.log(`(e) GET /j/${CODE} with cookie after check-in → HTTP ${usedRes.status}`);
  assert.equal(usedRes.status, 200);
  assert.ok(usedHtml.includes("Beléptetve"), "the flipped page must show „Beléptetve”");
  assert.ok(!usedHtml.includes("Beléptetés<"), "no Beléptetés button on a used ticket");
  console.log("    page flipped to „Beléptetve” ✓");

  console.log("check OK — all /j/[code] assertions passed.");
}

async function cleanup(db) {
  // Read the rows first so the printed ids are the ones that existed.
  const before = await ticketRow(db);
  console.log("cleaning up rows:");
  console.log("  rk_tickets: ", before?.id ?? "(none)", "code", CODE);

  const { data: orderId } = await db
    .from("rk_orders")
    .select("id")
    .eq("buyer_email", BUYER_EMAIL)
    .eq("concert_id", CONCERT_ID)
    .maybeSingle();

  await db.from("rk_tickets").delete().eq("code", CODE);
  if (orderId?.id) await db.from("rk_orders").delete().eq("id", orderId.id);
  await db.from("rk_concerts").delete().eq("concert_id", CONCERT_ID);
  console.log("  rk_orders:  ", orderId?.id ?? "(none)");
  console.log("  rk_concerts:", CONCERT_ID);

  // A delete result is never trusted — re-SELECT and assert what remains.
  const ticketLeft = await db.from("rk_tickets").select("id").eq("code", CODE);
  const orderLeft = await db
    .from("rk_orders")
    .select("id")
    .eq("buyer_email", BUYER_EMAIL)
    .eq("concert_id", CONCERT_ID);
  const concertLeft = await db.from("rk_concerts").select("concert_id").eq("concert_id", CONCERT_ID);
  assert.equal(
    (ticketLeft.data ?? []).length,
    0,
    `rk_tickets still holds ${CODE} after cleanup`,
  );
  assert.equal((orderLeft.data ?? []).length, 0, "rk_orders still holds the test order");
  assert.equal((concertLeft.data ?? []).length, 0, "rk_concerts still holds the test concert");
  console.log("cleanup OK — re-SELECT finds 0 test rows in rk_tickets / rk_orders / rk_concerts.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
