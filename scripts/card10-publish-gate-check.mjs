// Verification harness for card 10 („Jegyértékesítés indítása” disabled until
// every requirement is met). Run from the repo root against a dev server on
// port 3001 (npm run dev -- -p 3001). The DOM proofs run in a real browser
// against the same throwaway concert; this script only prepares the data,
// prints the saved state between the browser steps, and cleans everything up.
//
//   node scripts/card10-publish-gate-check.mjs setup
//     Removes leftovers of crashed runs, creates the throwaway concert
//     (future date, no types — state (a)) and prints its id.
//   node scripts/card10-publish-gate-check.mjs show <concertId>
//     Prints the concert's saved ticketing state from the list API (the same
//     endpoint the detail screen refreshes after every save).
//   node scripts/card10-publish-gate-check.mjs set-price-100 <concertId>
//     Sets every type's price to 100 Ft directly in rk_ticket_types — the PUT
//     route refuses prices under 200 Ft, so state (b) needs a direct write.
//   node scripts/card10-publish-gate-check.mjs patch-date <concertId> <huDate>
//     PATCHes the concert date through the intern API (e.g. back to future).
//   node scripts/card10-publish-gate-check.mjs cleanup
//     S3 line removal, DB row deletes, Stripe price/product cleanup; prints
//     every id it removed and verifies nothing is left behind.
//
// No Checkout Session, charge or refund is ever created; the Stripe price the
// type editor saves is deactivated and its product archived at cleanup.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

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

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" }) : null;

// ---------------------------------------------------------------------------
// "@/" alias hook + lib imports (live S3 concert admin)
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

// ---------------------------------------------------------------------------
// Throwaway data
// ---------------------------------------------------------------------------

const HU_MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];
const future = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
const futureHuDate = `${future.getFullYear()}. ${HU_MONTHS[future.getMonth()]} ${future.getDate()}.`;

const TITLE = "UI-teszt koncert – indítás";
const TYPE_NAME = "Teszt jegy – indítás";
/** Stripe product names of the throwaway: `Réz körút – UI-teszt koncert – indítás – …` */
const STRIPE_SWEEP_PREFIX = `Réz körút – ${TITLE}`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Cookie: COOKIE,
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

async function waitForDevServer() {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const probe = await fetch(`${BASE_URL}/api/intern/koncertek`, {
        headers: { Cookie: COOKIE },
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`dev server not reachable at ${BASE_URL}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// ---------------------------------------------------------------------------
// DB helpers (verify-then-delete — a supabase delete can return a truthy error
// object with message:null even though the rows were deleted)
// ---------------------------------------------------------------------------

async function deleteRows(table, column, values) {
  for (const value of values) {
    await supabase.from(table).delete().eq(column, value);
    const { data: after } = await supabase.from(table).select(column).eq(column, value);
    assert.equal(
      (after ?? []).length,
      0,
      `${table} rows for ${value} must be gone after delete`,
    );
  }
}

async function sweepLeftovers() {
  // DB: every concert row of a crashed run, plus its orders/tickets/types.
  const { data: staleConcerts, error: selectError } = await supabase
    .from("rk_concerts")
    .select("concert_id")
    .like("title", `${TITLE}%`);
  if (selectError) throw new Error(`rk_concerts select failed: ${selectError.message}`);
  const ids = (staleConcerts ?? []).map((row) => row.concert_id);
  const removed = [];
  for (const id of ids) {
    const { data: tickets } = await supabase.from("rk_tickets").select("id").eq("concert_id", id);
    for (const ticket of tickets ?? []) {
      await supabase.from("rk_orders").delete().eq("id", ticket.order_id ?? "");
      removed.push(`ticket ${ticket.id}`);
    }
    await deleteRows("rk_tickets", "id", (tickets ?? []).map((ticket) => ticket.id));
    const { data: orders } = await supabase.from("rk_orders").select("id").eq("concert_id", id);
    await deleteRows("rk_orders", "id", (orders ?? []).map((order) => order.id));
    await deleteRows("rk_concerts", "concert_id", [id]);
    removed.push(`concert ${id}`);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const command = process.argv[2];
const concertIdArg = process.argv[3];

switch (command) {
  case "setup": {
    await waitForDevServer();
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Throwaway concert (date ${futureHuDate}): "${TITLE}"`);

    const removed = await sweepLeftovers();
    console.log(`   leftovers removed first: ${removed.length ? removed.join(", ") : "none"}`);

    const created = await api("POST", "/api/intern/koncertek", {
      date: futureHuDate,
      time: "19:00",
      location: "Budapest",
      venue: "UI Teszt Terem",
      title: TITLE,
      program: [],
      href: "",
      href_label: "",
    });
    console.log(`   POST status: ${created.status}`);
    assert.equal(created.status, 200, "POST /api/intern/koncertek must answer 200");
    assert.ok(created.json?.concert?.id, "the created concert must carry an id");
    const concertId = created.json.concert.id;
    console.log(`   created concert id: ${concertId}`);
    console.log(`   ticketing status: ${created.json?.ticketing?.status}`);

    const detail = await api("GET", "/api/intern/koncertek");
    const entry = detail.json?.concerts?.find((concert) => concert.id === concertId);
    assert.ok(entry, "the list API must answer the new concert");
    // POST mirrors the concert into rk_concerts right away, so ticketing is
    // already {status:"draft", types:[]} — state (a): zero types, not on sale.
    assert.equal(entry.ticketing?.status, "draft", "a fresh concert must be draft");
    assert.equal((entry.ticketing?.types ?? []).length, 0, "a fresh concert must have zero types");
    console.log(`   list API: date "${entry.date}", ticketing: ${JSON.stringify(entry.ticketing)}`);
    console.log(`CONCERT_ID=${concertId}`);
    break;
  }

  case "show": {
    assert.ok(concertIdArg, "usage: show <concertId>");
    const detail = await api("GET", "/api/intern/koncertek");
    const entry = detail.json?.concerts?.find((concert) => concert.id === concertIdArg);
    assert.ok(entry, "the list API must answer the concert");
    console.log(`   id: ${entry.id}`);
    console.log(`   title: ${entry.title}`);
    console.log(`   date: ${entry.date}`);
    console.log(`   ticketing.status: ${entry.ticketing?.status ?? null}`);
    console.log(`   types: ${JSON.stringify(
      (entry.ticketing?.types ?? []).map((type) => ({
        id: type.id,
        name: type.name,
        price_huf: type.price_huf,
        active: type.active,
        stripe_price_id: type.stripe_price_id,
      })),
    )}`);
    break;
  }

  case "set-price-100": {
    assert.ok(concertIdArg, "usage: set-price-100 <concertId>");
    const { data: types, error } = await supabase
      .from("rk_ticket_types")
      .select("id,name,price_huf,stripe_price_id")
      .eq("concert_id", concertIdArg);
    if (error) throw new Error(`rk_ticket_types select failed: ${error.message}`);
    assert.ok((types ?? []).length > 0, "the concert must have at least one type");
    for (const type of types) {
      const { error: updateError } = await supabase
        .from("rk_ticket_types")
        .update({ price_huf: 100 })
        .eq("id", type.id);
      if (updateError) throw new Error(`rk_ticket_types update failed: ${updateError.message}`);
    }
    // Verify by re-reading (never trust the error object alone).
    const { data: after } = await supabase
      .from("rk_ticket_types")
      .select("id,name,price_huf,stripe_price_id")
      .eq("concert_id", concertIdArg);
    for (const type of after ?? []) {
      assert.equal(type.price_huf, 100, `type ${type.id} must now cost 100 Ft`);
      assert.ok(type.stripe_price_id, "the Stripe price must stay attached");
      console.log(`   type ${type.id} ("${type.name}"): price_huf 100, stripe_price_id kept`);
    }
    break;
  }

  case "patch-date": {
    assert.ok(concertIdArg && process.argv[4], "usage: patch-date <concertId> <huDate>");
    const patched = await api("PATCH", `/api/intern/koncertek/${concertIdArg}`, {
      date: process.argv[4],
    });
    console.log(`   PATCH status: ${patched.status}`);
    assert.equal(patched.status, 200, "PATCH must answer 200");
    console.log(`   date now: ${patched.json?.concert?.date}`);
    break;
  }

  case "cleanup": {
    console.log("== cleanup (idempotent)");
    // 1) S3: remove every throwaway line that is still present.
    const concerts = await admin.listUpcomingConcerts();
    const stale = concerts.filter((concert) => concert.title.startsWith(TITLE));
    for (const concert of stale) {
      if (!concert.id) {
        console.error(`   REFUSING S3 cleanup: leftover concert without id: ${concert.title}`);
        continue;
      }
      await admin.deleteConcert(concert.id);
      console.log(`   S3 line removed: ${concert.id} (${concert.title})`);
    }
    if (!stale.length) console.log("   S3: no throwaway line present");

    // 2) DB: sweep the rows (orders → tickets → concerts; types cascade).
    const removed = await sweepLeftovers();
    console.log(`   DB rows removed: ${removed.length ? removed.join(", ") : "none"}`);

    const { data: afterConcerts } = await supabase
      .from("rk_concerts")
      .select("concert_id")
      .like("title", `${TITLE}%`);
    const { data: afterTypes } = await supabase
      .from("rk_ticket_types")
      .select("id")
      .like("name", `${TYPE_NAME}%`);
    console.log(
      `   DB check: rk_concerts "${TITLE}%" rows: ${(afterConcerts ?? []).length} (want 0); rk_ticket_types "${TYPE_NAME}%" rows: ${(afterTypes ?? []).length} (want 0)`,
    );
    assert.equal((afterConcerts ?? []).length, 0, "no throwaway concert row may stay");
    assert.equal((afterTypes ?? []).length, 0, "no throwaway type row may stay");

    // 3) Stripe: deactivate the prices, delete (or archive) the product.
    if (stripe) {
      const priceIds = new Set();
      const productIds = new Set();
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
    break;
  }

  default:
    console.error(
      "usage: card10-publish-gate-check.mjs setup | show <id> | set-price-100 <id> | patch-date <id> <huDate> | cleanup",
    );
    process.exit(1);
}
