// Free-UI helper for card 11: prepares ONE throwaway free-only concert for the
// real-browser check of the buy page's „Jegy igénylése” flow, and cleans it up.
// (The API-level proofs live in scripts/card11-free-ticket-check.mjs — this
// helper exists so the browser steps can run between setup and cleanup.)
//
//   node scripts/card11-free-ui-check.mjs setup
//     Creates the throwaway free-only concert (0 Ft type, capacity 4),
//     publishes it and prints its id.
//   node scripts/card11-free-ui-check.mjs cleanup <concertId>
//     Deletes every throwaway row (tickets → orders → concert, ids printed),
//     removes the S3 line and verifies nothing is left. A free-only concert
//     never touches Stripe — verified again at cleanup.
//
// Run from the repo root against the dev server on port 3001. The buyer used
// in the browser phase is ORDER_CC (the owner's mailbox) — the successful
// request sends exactly one real ticket e-mail there.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

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
    // fall back to process.env
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

assert.ok(SUPABASE_URL && SERVICE_KEY, "Supabase env must be in .env.local");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" }) : null;

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

const HU_MONTHS = ["január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december"];
const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
const futureIsoDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
const TITLE = "Teszt – ingyenes 3";

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

async function removeConcert(concertId) {
  const delTickets = await supabase.from("rk_tickets").delete().eq("concert_id", concertId).select("id,code");
  assert.ok(!delTickets.error, `rk_tickets delete failed: ${delTickets.error?.message}`);
  const delOrders = await supabase.from("rk_orders").delete().eq("concert_id", concertId).select("id");
  assert.ok(!delOrders.error, `rk_orders delete failed: ${delOrders.error?.message}`);
  const { data: typesBefore } = await supabase
    .from("rk_ticket_types")
    .select("id,name")
    .eq("concert_id", concertId);
  const delConcert = await supabase.from("rk_concerts").delete().eq("concert_id", concertId).select("concert_id");
  assert.ok(!delConcert.error, `rk_concerts delete failed: ${delConcert.error?.message}`);
  console.log(`   ${concertId}:`);
  console.log(`     rk_tickets deleted (${delTickets.data?.length ?? 0}): ${(delTickets.data ?? []).map((row) => `${row.id} (${row.code})`).join(", ")}`);
  console.log(`     rk_orders deleted (${delOrders.data?.length ?? 0}): ${(delOrders.data ?? []).map((row) => row.id).join(", ")}`);
  console.log(`     rk_ticket_types cascaded (${(typesBefore ?? []).length}): ${(typesBefore ?? []).map((type) => `${type.id} (${type.name})`).join(", ")}`);
  console.log(`     rk_concerts deleted: ${(delConcert.data ?? []).map((row) => row.concert_id).join(", ")}`);
}

const command = process.argv[2];
switch (command) {
  case "setup": {
    // Remove leftovers of crashed runs first (idempotent).
    for (const concert of await admin.listUpcomingConcerts()) {
      if (concert.title === TITLE && concert.id) {
        await removeConcert(concert.id);
        await admin.deleteConcert(concert.id);
      }
    }

    const res = await api("POST", "/api/intern/koncertek", {
      date: futureIsoDate,
      time: "19:00",
      location: "Teszt város",
      venue: "Teszt terem 3",
      title: TITLE,
      program: ["Teszt szerző: Teszt mű"],
    });
    assert.equal(res.status, 200, `POST failed: ${JSON.stringify(res.json)}`);
    const concertId = res.json?.concert?.id;
    assert.ok(concertId, "the created concert must have an id");

    const put = await api("PUT", `/api/intern/koncertek/${concertId}/ticket-types`, {
      types: [{ name: "Ingyenes jegy", kind: "standard", price_huf: 0, capacity: 4, active: true, sort: 0 }],
    });
    assert.equal(put.status, 200, `PUT failed: ${JSON.stringify(put.json)}`);
    const type = put.json.types[0];
    assert.equal(type.price_huf, 0);
    assert.equal(type.stripe_price_id, null, "a free type must never touch Stripe");

    const publish = await api("POST", `/api/intern/koncertek/${concertId}/publish`, {});
    assert.equal(publish.status, 200, `publish failed: ${JSON.stringify(publish.json)}`);
    assert.equal(publish.json.concert.status, "on_sale");

    console.log(`setup ok — free-only concert on sale:`);
    console.log(`  id: ${concertId}`);
    console.log(`  buy page: ${BASE_URL}/jegyek/${concertId}`);
    console.log(`  type: ${type.id} (Ingyenes jegy, 0 Ft, capacity 4, stripe_price_id null)`);
    break;
  }
  case "cleanup": {
    const concertId = process.argv[3];
    assert.ok(concertId, "usage: cleanup <concertId>");
    console.log("== cleanup (idempotent)");
    await removeConcert(concertId);
    await admin.deleteConcert(concertId);
    for (const table of ["rk_concerts", "rk_ticket_types", "rk_orders", "rk_tickets"]) {
      const { data } = await supabase.from(table).select("id,concert_id").eq("concert_id", concertId);
      assert.equal((data ?? []).length, 0, `${table} must have 0 rows for ${concertId}`);
    }
    const remaining = await admin.listUpcomingConcerts();
    assert.ok(!remaining.some((concert) => concert.id === concertId || concert.title === TITLE));
    console.log(`   S3 line removed; verify: 0 rows in rk_concerts / rk_ticket_types / rk_orders / rk_tickets; ${remaining.length} concert lines left`);
    if (stripe) {
      const prices = await stripe.prices.list({ lookup_keys: [`rk:${concertId}:ingyenes-jegy-1`], limit: 10 });
      assert.equal(prices.data.length, 0, "a free-only concert must leave no Stripe price behind");
      let productHits = 0;
      for await (const product of stripe.products.list({ limit: 100 })) {
        if (product.name?.includes(TITLE)) productHits += 1;
      }
      assert.equal(productHits, 0, "a free-only concert must leave no Stripe product behind");
      console.log("   Stripe verify: 0 prices, 0 products for the free-only throwaway");
    }
    console.log("cleanup ok");
    break;
  }
  default:
    console.log("usage: card11-free-ui-check.mjs setup | cleanup <concertId>");
    process.exit(2);
}
