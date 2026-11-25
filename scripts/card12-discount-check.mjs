// Verification harness for card 12 (Kedvezménykódok — Stripe promotion codes).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/card12-discount-check.mjs
//
// STRIPE_SECRET_KEY is LIVE (sk_live_) — the owner's standing rule from card
// 03 was "never create a real Checkout Session, never take a payment"; card
// 12's OWN verification text overrides the first half for exactly one step:
// (b) creates ONE real Checkout Session with the discount attached and does
// NOT pay it (it expires unopened) so the printed amount_total /
// total_details.amount_discount come from a retrieved REAL session. No
// charge, no refund, no e-mail to an invented buyer (ORDER_CC only).
//
// Everything else follows the card's checklist:
//   a) create a 20% code through the dashboard API → Stripe coupon +
//      promotion code ids printed, row present (+ save-time validation
//      negatives: charset, percent range, both-kind, duplicate);
//   b) checkout with the code (lowercased — normalization is proven) →
//      session with the discount, amount_total / amount_discount printed
//      from a retrieved session; params verified through a stubbed client
//      (discounts vs allow_promotion_codes are mutually exclusive at Stripe);
//   c) signed paid webhook with the discounted amounts → order amount_huf =
//      the PAID total (not the list), discount_huf + discount_code stored,
//      times_redeemed = 1, per-ticket allocated prices printed;
//   c2) a crafted discounted order whose allocation produces a 0 Ft ticket —
//      the ticket is stored at 0 Ft and the allocation sum is exact;
//   d) invoice cron in DRAFT mode (no issue): the per-ticket allocated gross
//      prices are printed, their sum equals amount_huf exactly, the 0 Ft
//      ticket is NOT queued, the invoice note lines are verified (incl.
//      „Kedvezmény miatt 0 Ft”), nothing is issued;
//   e) exhausted / expired / inactive / unknown code → Hungarian refusal,
//      no session, no order row;
//   f) deactivate the code → the buy flow refuses it server-side;
//   cleanup: DB rows removed (verified), Stripe objects deactivated (ids
//      printed), the unpaid session expires on its own.
//
// The throwaway concert and its types are written directly to Supabase with
// the service key (the same approach as the card 10/11 harnesses); the
// 4 000 Ft type carries a REAL Stripe price so the real session in (b) can
// be created; the crafted-order types (200 Ft / 200 000 Ft) deliberately
// have no Stripe object — their webhook line items resolve through the
// price metadata fallback (resolveUnits).

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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
const WEBHOOK_SECRET = env("STRIPE_TICKET_WEBHOOK_SECRET");
const CRON_SECRET = env("CRON_SECRET");
const ORDER_CC = env("ORDER_CC");
const stripeMode = STRIPE_KEY ? (STRIPE_KEY.startsWith("sk_live_") ? "live" : "test") : null;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
assert.ok(STRIPE_KEY, "STRIPE_SECRET_KEY must be in .env.local");
assert.ok(WEBHOOK_SECRET, "STRIPE_TICKET_WEBHOOK_SECRET must be in .env.local");
assert.ok(CRON_SECRET, "CRON_SECRET must be in .env.local");
assert.ok(ORDER_CC, "ORDER_CC must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`Stripe key mode: ${stripeMode}`);
console.log(`Buyer e-mail for this run: ${ORDER_CC} (ORDER_CC — no invented address)`);

// Seed process.env for the imported server libs (lib/ticket-db reads process.env).
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_TICKET_WEBHOOK_SECRET",
  "TACITO_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAIL_FROM",
  "ORDER_CC",
]) {
  if (fileEnv[key] && !process.env[key]) process.env[key] = fileEnv[key];
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2026-04-22.dahlia" });

// ---------------------------------------------------------------------------
// "@" alias hook + server lib imports (same style as the earlier harnesses)
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

const checkoutLib = await import("../lib/ticket-checkout.ts");
const fulfilLib = await import("../lib/ticket-fulfil.ts");
const tacitoLib = await import("../lib/tacito.ts");

// ---------------------------------------------------------------------------
// HTTP + DB helpers
// ---------------------------------------------------------------------------

async function api(method, path, body, { withCookie = false, withCron = false } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(withCookie ? { Cookie: COOKIE } : {}),
      ...(withCron ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
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

let eventCount = 0;
let stubSessionCount = 0;
function makeEvent(type, object) {
  eventCount += 1;
  return {
    id: `evt_card12_${eventCount}`,
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}

async function postWebhook(event) {
  const raw = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/tickets/webhook/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": sig },
    body: raw,
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

function testBuyer() {
  return {
    name: "Teszt Vásárló",
    email: ORDER_CC,
    phone: "+36 30 111 2233",
    address: { postal_code: "9999", city: "Tesztváros", street: "Webes utca 9." },
  };
}

async function dbOrder(orderId) {
  const { data, error } = await supabase.from("rk_orders").select("*").eq("id", orderId).single();
  if (error) throw new Error(`rk_orders read failed: ${error.message}`);
  return data;
}

async function dbTickets(orderId) {
  const { data, error } = await supabase
    .from("rk_tickets")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw new Error(`rk_tickets read failed: ${error.message}`);
  return data ?? [];
}

async function dbDiscountRow(code) {
  const { data, error } = await supabase.from("rk_discount_codes").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(`rk_discount_codes read failed: ${error.message}`);
  return data ?? null;
}

/** Verify-then-delete (a supabase delete can return a truthy error with null message). */
async function deleteVerified(table, column, value) {
  await supabase.from(table).delete().eq(column, value);
  const { data: after } = await supabase.from(table).select(column).eq(column, value);
  const remaining = (after ?? []).length;
  if (remaining > 0) {
    await supabase.from(table).delete().eq(column, value);
    const { data: retry } = await supabase.from(table).select(column).eq(column, value);
    assert.equal((retry ?? []).length, 0, `${table}.${column}=${value} must be gone after cleanup`);
  }
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
    console.error(`   !! FAILED: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture: throwaway concert + types
// ---------------------------------------------------------------------------

const CONCERT_ID = "rk-2026-12-24-kedvezmeny-proba";
const CONCERT_TITLE = "Réz körút – Teszt kedvezménykód";
const TYPE_A_PRICE_HUF = 4000;
const TYPE_B_PRICE_HUF = 200;
const TYPE_C_PRICE_HUF = 200_000;
let typeAId = "";
let typeBId = "";
let typeCId = "";
let realPriceId = "";
let realProductId = "";
let orderA = null; // { orderId, sessionId }
let orderB = null; // { orderId }
const created = { promoIds: [], couponIds: [], codeRows: [] };

await section("(setup) throwaway concert + types", async () => {
  // Clean slate: a previous crashed run may have left rows behind.
  await supabase.from("rk_tickets").delete().eq("concert_id", CONCERT_ID);
  await supabase.from("rk_orders").delete().eq("concert_id", CONCERT_ID);
  await supabase.from("rk_ticket_types").delete().eq("concert_id", CONCERT_ID);
  await supabase.from("rk_concerts").delete().eq("concert_id", CONCERT_ID);
  await supabase.from("rk_discount_codes").delete().eq("concert_id", CONCERT_ID);
  await supabase.from("rk_discount_codes").delete().eq("code", "like", "TESZT%");

  const { error: concertError } = await supabase.from("rk_concerts").insert({
    concert_id: CONCERT_ID,
    title: CONCERT_TITLE,
    event_date: "2026-12-24",
    event_time: "19:00",
    location: "Budapest",
    venue: "Teszt Terem",
    status: "on_sale",
  });
  assert.ok(!concertError, `rk_concerts insert failed: ${concertError?.message}`);

  // The REAL Stripe price for the 4 000 Ft type (the (b) session needs it).
  const product = await stripe.products.create({ name: `Réz körút – ${CONCERT_TITLE} – Teszt` });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: TYPE_A_PRICE_HUF * 100,
    currency: "huf",
  });
  realProductId = product.id;
  realPriceId = price.id;
  console.log(`   Stripe product: ${product.id} | price: ${price.id} (${TYPE_A_PRICE_HUF} Ft)`);

  const { data: types, error: typesError } = await supabase
    .from("rk_ticket_types")
    .insert([
      {
        concert_id: CONCERT_ID,
        name: "Teljes árú jegy",
        kind: "standard",
        price_huf: TYPE_A_PRICE_HUF,
        capacity: 20,
        sold: 0,
        stripe_price_id: realPriceId,
        stripe_lookup_key: `rk:${CONCERT_ID}:teszt-a-1`,
        active: true,
        sort: 0,
      },
      {
        concert_id: CONCERT_ID,
        name: "Kistest",
        kind: "standard",
        price_huf: TYPE_B_PRICE_HUF,
        capacity: 20,
        sold: 0,
        stripe_price_id: null,
        stripe_lookup_key: `rk:${CONCERT_ID}:teszt-b-2`,
        active: true,
        sort: 1,
      },
      {
        concert_id: CONCERT_ID,
        name: "Nagytest",
        kind: "standard",
        price_huf: TYPE_C_PRICE_HUF,
        capacity: 20,
        sold: 0,
        stripe_price_id: null,
        stripe_lookup_key: `rk:${CONCERT_ID}:teszt-c-3`,
        active: true,
        sort: 2,
      },
    ])
    .select();
  assert.ok(!typesError, `rk_ticket_types insert failed: ${typesError?.message}`);
  typeAId = types[0].id;
  typeBId = types[1].id;
  typeCId = types[2].id;
  console.log(`   types: A ${TYPE_A_PRICE_HUF} Ft (real price) | B ${TYPE_B_PRICE_HUF} Ft | C ${TYPE_C_PRICE_HUF} Ft`);
});

// ---------------------------------------------------------------------------
// (a) create the 20% code through the dashboard API
// ---------------------------------------------------------------------------

const CODE_MAIN = "TESZT20";
await section("(a) 20% kedvezménykód létrehozása a dashboard API-n", async () => {
  // Save-time validation negatives first — each refuses with the Hungarian message.
  const negatives = [
    [{ code: "rossz kód!", percent_off: 20 }, "charset"],
    [{ code: "TESZTPCT0", percent_off: 0 }, "percent range"],
    [{ code: "TESZTPCT150", percent_off: 150 }, "percent range"],
    [{ code: "TESZTBOTH", percent_off: 20, amount_off_huf: 1000 }, "both kinds"],
    [{ code: "TESZTNOVAL" }, "no kind"],
  ];
  for (const [body, label] of negatives) {
    const res = await api("POST", "/api/intern/kedvezmenykodok", body, { withCookie: true });
    assert.equal(res.status, 400, `${label} must be refused with 400 (got ${res.status}: ${JSON.stringify(res.json)})`);
    assert.ok(typeof res.json?.error === "string" && res.json.error.length > 0, `${label} refusal must carry a Hungarian message`);
    console.log(`   refused ${label}: 400 ${res.json.error}`);
  }
  const noAuth = await api("POST", "/api/intern/kedvezmenykodok", { code: "X", percent_off: 20 });
  assert.equal(noAuth.status, 401, "the route must be intern-cookie-gated");

  // The real create.
  const res = await api(
    "POST",
    "/api/intern/kedvezmenykodok",
    { code: CODE_MAIN, percent_off: 20, concert_id: CONCERT_ID },
    { withCookie: true },
  );
  assert.equal(res.status, 200, `create must answer 200 (got ${res.status}: ${JSON.stringify(res.json)})`);
  const couponId = res.json.stripe_coupon_id;
  const promoId = res.json.stripe_promotion_code_id;
  console.log(`   Stripe coupon id: ${couponId}`);
  console.log(`   Stripe promotion code id: ${promoId}`);
  created.couponIds.push(couponId);
  created.promoIds.push(promoId);
  created.codeRows.push(CODE_MAIN);

  const row = await dbDiscountRow(CODE_MAIN);
  assert.ok(row, "the rk_discount_codes row must be present");
  assert.equal(row.stripe_coupon_id, couponId);
  assert.equal(row.stripe_promotion_code_id, promoId);
  assert.equal(row.percent_off, 20);
  assert.equal(row.amount_off_huf, null);
  assert.equal(row.max_redemptions, null);
  assert.equal(row.concert_id, CONCERT_ID);
  assert.equal(row.active, true);
  console.log(`   row present: ${row.id} | active ${row.active} | times_redeemed ${row.times_redeemed}`);

  // Duplicate refusal.
  const dup = await api("POST", "/api/intern/kedvezmenykodok", { code: CODE_MAIN, percent_off: 10 }, { withCookie: true });
  assert.equal(dup.status, 400, "a duplicate code must be refused");
  console.log(`   duplicate refused: ${dup.json.error}`);

  // The Stripe objects are live and valid.
  const promo = await stripe.promotionCodes.retrieve(promoId);
  assert.equal(promo.code, CODE_MAIN);
  assert.equal(promo.active, true);
  const coupon = await stripe.coupons.retrieve(couponId);
  assert.equal(coupon.percent_off, 20);
  console.log(`   Stripe promotion code verified: ${promo.code} active=${promo.active} coupon percent_off=${coupon.percent_off}`);
});

// ---------------------------------------------------------------------------
// (b) checkout with the code → real session with the discount
// ---------------------------------------------------------------------------

let sessionAmountTotal = null;
let sessionAmountDiscount = null;
await section("(b) fizetés indítása a kóddal → session a kedvezménnyel", async () => {
  const ordersBefore = await supabase
    .from("rk_orders")
    .select("id")
    .eq("concert_id", CONCERT_ID);
  const countBefore = (ordersBefore.data ?? []).length;

  // Lowercase input proves the uppercase normalization end-to-end.
  const res = await api("POST", "/api/tickets/checkout", {
    concert_id: CONCERT_ID,
    items: [{ ticket_type_id: typeAId, quantity: 2 }],
    buyer: testBuyer(),
    accept_terms: true,
    discount_code: CODE_MAIN.toLowerCase(),
  });
  assert.equal(res.status, 200, `checkout must answer 200 (got ${res.status}: ${JSON.stringify(res.json)})`);
  assert.ok(res.json?.url, "the checkout must return the hosted URL");

  // The pending order the route created (found by session id below).
  const { data: orderRows } = await supabase
    .from("rk_orders")
    .select("*")
    .eq("concert_id", CONCERT_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  const order = orderRows[0];
  assert.equal(order.status, "pending");
  assert.equal(order.amount_huf, 2 * TYPE_A_PRICE_HUF, "the pending order stores the LIST total");
  orderA = { orderId: order.id, sessionId: order.stripe_session_id };

  // Retrieve the REAL session — create only, never paid.
  const session = await stripe.checkout.sessions.retrieve(orderA.sessionId);
  sessionAmountTotal = session.amount_total;
  sessionAmountDiscount = session.total_details?.amount_discount ?? null;
  console.log(`   session: ${session.id}`);
  console.log(`   retrieved amount_total: ${sessionAmountTotal} fillér (${sessionAmountTotal / 100} Ft)`);
  console.log(
    `   retrieved total_details.amount_discount: ${sessionAmountDiscount} fillér (${sessionAmountDiscount === null ? "–" : sessionAmountDiscount / 100} Ft)`,
  );
  assert.equal(sessionAmountTotal, 2 * TYPE_A_PRICE_HUF * 100 * 0.8, "amount_total must be the 20% discounted total");
  assert.equal(sessionAmountDiscount, 2 * TYPE_A_PRICE_HUF * 100 * 0.2, "amount_discount must be the 20% discount");
  assert.equal(
    (session.discounts ?? [])[0]?.promotion_code,
    (await dbDiscountRow(CODE_MAIN)).stripe_promotion_code_id,
    "the session must carry our promotion code",
  );

  // Exactly one new order row so far (the stubbed calls below insert two more
  // throwaway pending rows — they are cleaned up with the concert).
  const ordersAfterReal = await supabase.from("rk_orders").select("id").eq("concert_id", CONCERT_ID);
  assert.equal((ordersAfterReal.data ?? []).length, countBefore + 1, "exactly one new order row from the real checkout");

  // Session params through a stubbed client (the live key never gets a second session):
  // typed code → discounts, NO allow_promotion_codes (mutually exclusive at Stripe).
  const withCode = await stubbedCheckout({ ...minimalCheckoutBody(), discount_code: CODE_MAIN.toLowerCase() });
  assert.ok(withCode.params.discounts, "a typed code must attach discounts:[{promotion_code}]");
  assert.equal(withCode.params.discounts[0].promotion_code, (await dbDiscountRow(CODE_MAIN)).stripe_promotion_code_id);
  assert.equal(withCode.params.allow_promotion_codes, undefined, "discounts and allow_promotion_codes are mutually exclusive");
  // no typed code → allow_promotion_codes:true, no discounts.
  const withoutCode = await stubbedCheckout(minimalCheckoutBody());
  assert.equal(withoutCode.params.allow_promotion_codes, true, "without a typed code the buyer may enter one on the Stripe page");
  assert.equal(withoutCode.params.discounts, undefined);
  console.log("   params verified: typed code → discounts, no code → allow_promotion_codes");
});

function minimalCheckoutBody() {
  return {
    concert_id: CONCERT_ID,
    items: [{ ticket_type_id: typeAId, quantity: 1 }],
    buyer: testBuyer(),
    accept_terms: true,
  };
}

/** Drives the REAL pipeline with a stubbed Stripe client (params recorded, no session). */
async function stubbedCheckout(body) {
  const recorded = {};
  const stub = {
    checkout: {
      sessions: {
        async create(params) {
          stubSessionCount += 1;
          recorded.params = params;
          // Unique id per call — stripe_session_id is unique in rk_orders.
          return { id: `cs_card12_stub_${stubSessionCount}`, url: "https://checkout.stripe.com/stub", amount_total: 400000 };
        },
      },
    },
  };
  const parsed = checkoutLib.parseCheckoutRequest(body);
  assert.ok(!("error" in parsed), `parse failed: ${parsed.error}`);
  await checkoutLib.createOrderAndCheckoutSession(stub, parsed.request, BASE_URL);
  return recorded;
}

// ---------------------------------------------------------------------------
// (c) signed paid webhook with the discounted amounts
// ---------------------------------------------------------------------------

await section("(c) fizetett webhook a kedvezményes összegekkel → attribúció", async () => {
  const sessionObject = {
    id: orderA.sessionId,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: sessionAmountTotal,
    amount_subtotal: 2 * TYPE_A_PRICE_HUF * 100,
    currency: "huf",
    client_reference_id: orderA.orderId,
    metadata: { order_id: orderA.orderId, concert_id: CONCERT_ID },
    payment_intent: "pi_card12_a",
    total_details: {
      amount_discount: sessionAmountDiscount,
      amount_shipping: 0,
      amount_tax: 0,
    },
    discounts: [{ coupon: (await dbDiscountRow(CODE_MAIN)).stripe_coupon_id, promotion_code: (await dbDiscountRow(CODE_MAIN)).stripe_promotion_code_id }],
    customer_details: {
      name: testBuyer().name,
      email: ORDER_CC,
      phone: "+36 30 111 2233",
      address: { city: "Weblapváros", country: "HU", line1: "Webes utca 9.", postal_code: "9999" },
    },
    line_items: {
      object: "list",
      total_count: 1,
      has_more: false,
      data: [
        {
          id: "li_card12_a",
          object: "item",
          quantity: 2,
          price: { id: realPriceId, object: "price" },
        },
      ],
    },
  };
  const res = await postWebhook(makeEvent("checkout.session.completed", sessionObject));
  console.log(`   webhook status: ${res.status} | fulfil: ${JSON.stringify(res.json?.fulfil?.outcome)} (${res.json?.fulfil?.ticket_count} tickets)`);
  assert.equal(res.status, 200, "the signed webhook must answer 200");
  assert.equal(res.json?.fulfil?.outcome, "fulfilled");
  assert.equal(res.json?.fulfil?.ticket_count, 2);

  const order = await dbOrder(orderA.orderId);
  const paidHuf = sessionAmountTotal / 100;
  const discountHuf = sessionAmountDiscount / 100;
  console.log(`   order amount_huf: ${order.amount_huf} Ft (list 8000 — the PAID total, never the list price)`);
  console.log(`   order discount_huf: ${order.discount_huf} Ft | discount_code: ${order.discount_code}`);
  assert.equal(order.status, "paid");
  assert.equal(order.amount_huf, paidHuf, "amount_huf must be the discounted PAID total");
  assert.equal(order.discount_huf, discountHuf, "discount_huf must be the session's discount");
  assert.equal(order.discount_code, CODE_MAIN, "discount_code must be the code the buyer typed");

  const row = await dbDiscountRow(CODE_MAIN);
  assert.equal(row.times_redeemed, 1, "times_redeemed must be 1");
  console.log(`   times_redeemed: ${row.times_redeemed}`);

  const tickets = await dbTickets(orderA.orderId);
  const sum = tickets.reduce((acc, ticket) => acc + ticket.price_huf, 0);
  for (const ticket of tickets) {
    console.log(`   ticket: ${ticket.ticket_type_name} | ${ticket.price_huf} Ft (allocated) | code ${ticket.code}`);
  }
  assert.equal(sum, paidHuf, "the allocated per-ticket prices must sum to the paid amount");
  assert.ok(tickets.every((ticket) => ticket.price_huf === paidHuf / 2), "a single-type 20% split is even");

  // Replay: idempotent — times_redeemed stays 1, still 2 tickets.
  const replay = await postWebhook(makeEvent("checkout.session.completed", sessionObject));
  assert.equal(replay.status, 200);
  assert.equal(replay.json?.fulfil?.outcome, "already_fulfilled", "a replayed event must not double-fulfil");
  const rowAfterReplay = await dbDiscountRow(CODE_MAIN);
  assert.equal(rowAfterReplay.times_redeemed, 1, "the replay must not double-count the redemption");
  console.log("   replay idempotent: already_fulfilled, times_redeemed still 1");
});

// ---------------------------------------------------------------------------
// (c2) crafted discounted order whose allocation produces a 0 Ft ticket
// ---------------------------------------------------------------------------

const CODE_B = "TESZTB";
await section("(c2) 0 Ft-ra allokálódó jegy („Kedvezmény miatt 0 Ft”)", async () => {
  // A global amount-off code for the crafted order (the webhook reads the
  // session's amounts — the code row supplies the code string + the counter).
  const createRes = await api("POST", "/api/intern/kedvezmenykodok", { code: CODE_B, amount_off_huf: 1000 }, { withCookie: true });
  assert.equal(createRes.status, 200, `create of ${CODE_B} must answer 200: ${JSON.stringify(createRes.json)}`);
  const rowB = await dbDiscountRow(CODE_B);
  createdCouponIdsPush(createRes.json.stripe_coupon_id);
  createdPromoIdsPush(createRes.json.stripe_promotion_code_id);
  codeRowsPush(CODE_B);

  // Order B directly in the DB (the crafted amounts are unreachable through
  // the real checkout — that is the point of the extreme allocation).
  const { data: order, error } = await supabase
    .from("rk_orders")
    .insert({
      concert_id: CONCERT_ID,
      buyer_name: testBuyer().name,
      buyer_email: ORDER_CC,
      buyer_phone: "+36 30 111 2233",
      address_postal: "9999",
      address_city: "Tesztváros",
      address_street: "Webes utca 9.",
      amount_huf: TYPE_C_PRICE_HUF + 2 * TYPE_B_PRICE_HUF,
      currency: "HUF",
      status: "pending",
    })
    .select()
    .single();
  assert.ok(!error, `rk_orders insert failed: ${error?.message}`);
  orderB = { orderId: order.id };

  const listTotal = TYPE_C_PRICE_HUF + 2 * TYPE_B_PRICE_HUF; // 200 400 Ft
  const paidB = 200; // minimal paid amount
  const discountB = listTotal - paidB; // 200 200 Ft
  const sessionObject = {
    id: "cs_card12_b",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: paidB * 100,
    amount_subtotal: listTotal * 100,
    currency: "huf",
    client_reference_id: orderB.orderId,
    metadata: { order_id: orderB.orderId, concert_id: CONCERT_ID },
    payment_intent: "pi_card12_b",
    total_details: { amount_discount: discountB * 100, amount_shipping: 0, amount_tax: 0 },
    discounts: [{ coupon: rowB.stripe_coupon_id, promotion_code: rowB.stripe_promotion_code_id }],
    customer_details: {
      name: testBuyer().name,
      email: ORDER_CC,
      phone: "+36 30 111 2233",
      address: { city: "Weblapváros", country: "HU", line1: "Webes utca 9.", postal_code: "9999" },
    },
    line_items: {
      object: "list",
      total_count: 2,
      has_more: false,
      data: [
        {
          id: "li_card12_c",
          object: "item",
          quantity: 1,
          price: { id: "price_card12_fake_c", object: "price", metadata: { ticket_type_id: typeCId } },
        },
        {
          id: "li_card12_b",
          object: "item",
          quantity: 2,
          price: { id: "price_card12_fake_b", object: "price", metadata: { ticket_type_id: typeBId } },
        },
      ],
    },
  };
  const res = await postWebhook(makeEvent("checkout.session.completed", sessionObject));
  assert.equal(res.status, 200, `webhook B must answer 200 (${JSON.stringify(res.json)})`);
  assert.equal(res.json?.fulfil?.outcome, "fulfilled");

  const orderRow = await dbOrder(orderB.orderId);
  assert.equal(orderRow.amount_huf, paidB, "order B amount_huf must be the paid 200 Ft");
  assert.equal(orderRow.discount_huf, discountB);
  assert.equal(orderRow.discount_code, CODE_B);

  const tickets = await dbTickets(orderB.orderId);
  const prices = tickets.map((ticket) => ticket.price_huf);
  console.log(`   allocated: ${prices.join(" + ")} = ${prices.reduce((a, b) => a + b, 0)} Ft (paid ${paidB})`);
  assert.equal(prices.reduce((a, b) => a + b, 0), paidB, "the sum of the allocated prices must equal the paid amount exactly");
  assert.equal(prices.filter((price) => price === 0).length, 1, "exactly one ticket must allocate to 0 Ft");
  const zero = tickets.find((ticket) => ticket.price_huf === 0);
  console.log(`   0 Ft ticket: ${zero.ticket_type_name} | code ${zero.code} — free ticket, no invoice`);

  // Pure-function spot checks on the allocator (the invariant in general).
  const alloc = fulfilLib.allocateDiscountGross;
  assert.deepEqual(alloc([4000, 4000], { paidHuf: 6400, discountHuf: 1600, discountCode: "X", discountRowId: null }), [3200, 3200]);
  const proportional = alloc([4000, 1000], { paidHuf: 1000, discountHuf: 4000, discountCode: "X", discountRowId: null });
  assert.equal(proportional[0] + proportional[1], 1000);
  assert.deepEqual(alloc([500, 500, 500], { paidHuf: 1000, discountHuf: 500, discountCode: "X", discountRowId: null }), [333, 333, 334]);
  // Random-ish domain cases (list prices ≥ 200 Ft, max 6 tickets): the sum is
  // exact and each allocation stays within its list price — the in-domain
  // guarantee; the exact sum is the card's own requirement.
  let caseNo = 0;
  for (const [list, paid] of [
    [[3000], 1500], [[2000, 2000], 399], [[1000, 200, 300], 200], [[99900, 678, 900],
      45600], [[200, 200, 200, 200, 200, 200000], 200],
    [[12345, 678, 900], 456],
  ]) {
    caseNo += 1;
    const discount = list.reduce((a, b) => a + b, 0) - paid;
    const out = alloc(list, { paidHuf: paid, discountHuf: discount, discountCode: "X", discountRowId: null });
    assert.equal(out.reduce((a, b) => a + b, 0), paid, `case ${caseNo}: sum must be exact`);
    out.forEach((value, index) => assert.ok(value >= 0 && value <= list[index], `case ${caseNo}: bounds`));
  }
  console.log(`   allocator invariant verified on ${caseNo + 3} cases`);

  // Invoice note lines through the SAME builder the cron uses.
  const concert = { title: CONCERT_TITLE, event_date: "2026-12-24", event_time: "19:00", venue: "Teszt Terem", location: "Budapest" };
  const noteA = tacitoLib.buildTicketInvoice(
    { ...orderA_fields(), discount_code: CODE_MAIN, discount_huf: 1600 },
    { id: "t1", price_huf: 3200, ticket_type_name: "Teljes árú jegy", code: "AAAAAAAAAA" },
    concert,
  ).payload.invoice_note;
  assert.ok(noteA.includes(`Kedvezmény: ${CODE_MAIN} (-1\u00a0600 Ft)`), `the note must carry the discount line: ${JSON.stringify(noteA)}`);
  assert.ok(!noteA.includes("Kedvezmény miatt 0 Ft"), "order A has no 0 Ft ticket");
  console.log(`   invoice note (order A): ${JSON.stringify(noteA)}`);

  const orderBrow = await dbOrder(orderB.orderId);
  const noteB = tacitoLib.buildTicketInvoice(
    {
      id: orderBrow.id,
      buyer_name: orderBrow.buyer_name,
      buyer_email: orderBrow.buyer_email,
      buyer_tax_number: orderBrow.buyer_tax_number,
      address_country: orderBrow.address_country,
      address_postal: orderBrow.address_postal,
      address_city: orderBrow.address_city,
      address_street: orderBrow.address_street,
      paid_at: orderBrow.paid_at,
      discount_code: orderBrow.discount_code,
      discount_huf: orderBrow.discount_huf,
    },
    { id: "t2", price_huf: 199, ticket_type_name: "Nagytest", code: "BBBBBBBBBB" },
    concert,
    { orderHasZeroPricedTicket: true },
  ).payload.invoice_note;
  assert.ok(noteB.includes(`Kedvezmény: ${CODE_B} (-200\u00a0200 Ft)`), "order B note must carry the discount line");
  assert.ok(noteB.includes("Kedvezmény miatt 0 Ft"), "order B note must say Kedvezmény miatt 0 Ft");
  console.log(`   invoice note (order B): ${JSON.stringify(noteB)}`);
});

function orderA_fields() {
  return {
    id: orderA.orderId,
    buyer_name: "Teszt Vásárló",
    buyer_email: ORDER_CC,
    buyer_tax_number: null,
    address_country: "HU",
    address_postal: "9999",
    address_city: "Tesztváros",
    address_street: "Webes utca 9.",
    paid_at: new Date().toISOString(),
  };
}

// The created-objects helpers (hoisted use inside sections).
function createdCouponIdsPush(id) {
  created.couponIds.push(id);
}
function createdPromoIdsPush(id) {
  created.promoIds.push(id);
}
function codeRowsPush(code) {
  created.codeRows.push(code);
}

// ---------------------------------------------------------------------------
// (d) invoice cron in draft mode
// ---------------------------------------------------------------------------

await section("(d) számlázó cron piszkozat módban — allokált bruttó árak", async () => {
  // Snapshot of pre-existing TACITo drafts, so only THIS run's leftovers fail.
  const draftsBefore = new Set((await tacitoListDrafts()).map((invoice) => invoice.id));

  const res = await api("GET", "/api/cron/tacito-invoices?draft=1", undefined, { withCron: true });
  assert.equal(res.status, 200, `draft cron must answer 200 (${JSON.stringify(res.json)})`);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.draft, true, "the run must be a draft run");
  assert.equal(res.json?.issued, 0, "draft mode must issue nothing");

  const drafts = res.json?.draft_details ?? [];
  console.log(`   draft_details (${drafts.length}):`);
  for (const draft of drafts) {
    console.log(`     order ${draft.order_id.slice(0, 8)}… | ticket ${draft.ticket_code} | ${draft.unit_price_gross} Ft`);
  }

  // Order A: both tickets queued, prices 3200 + 3200 = amount_huf (6400).
  const draftsA = drafts.filter((draft) => draft.order_id === orderA.orderId);
  assert.equal(draftsA.length, 2, "both tickets of order A must queue for a draft");
  const sumA = draftsA.reduce((sum, draft) => sum + draft.unit_price_gross, 0);
  const orderArow = await dbOrder(orderA.orderId);
  console.log(`   order A: ${draftsA.map((d) => d.unit_price_gross).join(" + ")} = ${sumA} Ft | amount_huf ${orderArow.amount_huf} Ft`);
  assert.equal(sumA, orderArow.amount_huf, "the allocated per-ticket gross prices must sum to amount_huf EXACTLY");

  // Order B: only the two non-zero tickets queue (the 0 Ft one never queues).
  const draftsB = drafts.filter((draft) => draft.order_id === orderB.orderId);
  const sumB = draftsB.reduce((sum, draft) => sum + draft.unit_price_gross, 0);
  const orderBrow = await dbOrder(orderB.orderId);
  const ticketsB = await dbTickets(orderB.orderId);
  console.log(`   order B: ${draftsB.map((d) => d.unit_price_gross).join(" + ")} = ${sumB} Ft | amount_huf ${orderBrow.amount_huf} Ft | tickets ${ticketsB.length}`);
  assert.equal(draftsB.length, 2, "the 0 Ft ticket must NOT queue (free ticket, no invoice)");
  assert.equal(sumB, orderBrow.amount_huf, "order B's queued gross prices must sum to amount_huf EXACTLY");

  // Nothing was issued or stored by the draft run.
  const ticketsAll = [...(await dbTickets(orderA.orderId)), ...(await dbTickets(orderB.orderId))];
  assert.ok(ticketsAll.every((ticket) => ticket.tacito_invoice_id === null), "draft mode must not store any invoice id");
  assert.ok(ticketsAll.every((ticket) => !ticket.tacito_error), "draft mode must not leave errors behind");

  // The drafts were deleted again (the TACITo tenant must not keep this run's drafts).
  const draftsAfter = await tacitoListDrafts();
  const newDrafts = draftsAfter.filter((invoice) => !draftsBefore.has(invoice.id));
  console.log(`   TACITo drafts left behind by this run: ${newDrafts.length}`);
  assert.equal(newDrafts.length, 0, "every draft created by the draft run must be deleted");
});

async function tacitoListDrafts() {
  // Read-only list with the same key the cron uses.
  const client = new tacitoLib.TacitoClient({});
  const invoices = await client.listInvoices();
  return invoices.filter((invoice) => invoice.state === "DRAFT");
}

// ---------------------------------------------------------------------------
// (e) exhausted / expired / inactive / unknown → Hungarian refusal, no session
// ---------------------------------------------------------------------------

await section("(e) kimerült / lejárt / inaktív / ismeretlen kód → magyar visszautasítás", async () => {
  const ordersBefore = await supabase.from("rk_orders").select("id").eq("concert_id", CONCERT_ID);
  const countBefore = (ordersBefore.data ?? []).length;

  const bodyWithCode = (code) => ({
    concert_id: CONCERT_ID,
    items: [{ ticket_type_id: typeAId, quantity: 1 }],
    buyer: testBuyer(),
    accept_terms: true,
    discount_code: code,
  });

  // Unknown.
  const unknown = await api("POST", "/api/tickets/checkout", bodyWithCode("NINCSILYANKOD"));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json?.error, "discount_unknown");
  console.log(`   ismeretlen: ${unknown.status} ${unknown.json.message}`);

  // Exhausted: max_redemptions 1, our counter already at 1.
  const codeEx = "TESZT1X";
  const createdEx = await api(
    "POST",
    "/api/intern/kedvezmenykodok",
    { code: codeEx, percent_off: 5, concert_id: CONCERT_ID, max_redemptions: 1 },
    { withCookie: true },
  );
  assert.equal(createdEx.status, 200, `create of ${codeEx} failed: ${JSON.stringify(createdEx.json)}`);
  createdCouponIdsPush(createdEx.json.stripe_coupon_id);
  createdPromoIdsPush(createdEx.json.stripe_promotion_code_id);
  codeRowsPush(codeEx);
  const { error: bumpError } = await supabase
    .from("rk_discount_codes")
    .update({ times_redeemed: 1 })
    .eq("code", codeEx);
  assert.ok(!bumpError, `times_redeemed bump failed: ${bumpError?.message}`);
  const exhausted = await api("POST", "/api/tickets/checkout", bodyWithCode(codeEx));
  assert.equal(exhausted.status, 409);
  assert.equal(exhausted.json?.error, "discount_exhausted");
  console.log(`   kimerült: ${exhausted.status} ${exhausted.json.message}`);

  // Expired: expires 2 s in the future, then it is past.
  const codeExp = "TESZTLEJART";
  const createdExp = await api(
    "POST",
    "/api/intern/kedvezmenykodok",
    { code: codeExp, percent_off: 5, concert_id: CONCERT_ID, expires_at: new Date(Date.now() + 2000).toISOString() },
    { withCookie: true },
  );
  assert.equal(createdExp.status, 200, `create of ${codeExp} failed: ${JSON.stringify(createdExp.json)}`);
  createdCouponIdsPush(createdExp.json.stripe_coupon_id);
  createdPromoIdsPush(createdExp.json.stripe_promotion_code_id);
  codeRowsPush(codeExp);
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const expired = await api("POST", "/api/tickets/checkout", bodyWithCode(codeExp));
  assert.equal(expired.status, 409);
  assert.equal(expired.json?.error, "discount_expired");
  console.log(`   lejárt: ${expired.status} ${expired.json.message}`);

  // Inactive.
  const codeOff = "TESZTKI";
  const createdOff = await api(
    "POST",
    "/api/intern/kedvezmenykodok",
    { code: codeOff, percent_off: 5, concert_id: CONCERT_ID },
    { withCookie: true },
  );
  assert.equal(createdOff.status, 200, `create of ${codeOff} failed: ${JSON.stringify(createdOff.json)}`);
  createdCouponIdsPush(createdOff.json.stripe_coupon_id);
  createdPromoIdsPush(createdOff.json.stripe_promotion_code_id);
  codeRowsPush(codeOff);
  const rowOff = await dbDiscountRow(codeOff);
  const off = await api("PATCH", `/api/intern/kedvezmenykodok/${rowOff.id}`, { active: false }, { withCookie: true });
  assert.equal(off.status, 200, `deactivation failed: ${JSON.stringify(off.json)}`);
  assert.equal(off.json?.code?.active, false);
  const inactive = await api("POST", "/api/tickets/checkout", bodyWithCode(codeOff));
  assert.equal(inactive.status, 409);
  assert.equal(inactive.json?.error, "discount_inactive");
  console.log(`   inaktív: ${inactive.status} ${inactive.json.message}`);

  // No order row and no session was created by any refusal.
  const ordersAfter = await supabase.from("rk_orders").select("id").eq("concert_id", CONCERT_ID);
  assert.equal((ordersAfter.data ?? []).length, countBefore, "no session and no order row may be created by a refused code");
});

// ---------------------------------------------------------------------------
// (f) deactivate the main code → the buy flow refuses it server-side
// ---------------------------------------------------------------------------

await section("(f) a kód kikapcsolása → a vásárlási flow elutasítja", async () => {
  const row = await dbDiscountRow(CODE_MAIN);
  const off = await api("PATCH", `/api/intern/kedvezmenykodok/${row.id}`, { active: false }, { withCookie: true });
  assert.equal(off.status, 200, `deactivation of ${CODE_MAIN} failed: ${JSON.stringify(off.json)}`);

  // The Stripe promotion code is inactive too.
  const promo = await stripe.promotionCodes.retrieve(row.stripe_promotion_code_id);
  assert.equal(promo.active, false, "the Stripe promotion code must be inactive");

  // The buy flow refuses the typed code server-side (the buy page offers the
  // field; a deactivated code never reaches a session).
  const res = await api("POST", "/api/tickets/checkout", {
    concert_id: CONCERT_ID,
    items: [{ ticket_type_id: typeAId, quantity: 1 }],
    buyer: testBuyer(),
    accept_terms: true,
    discount_code: CODE_MAIN,
  });
  assert.equal(res.status, 409);
  assert.equal(res.json?.error, "discount_inactive");
  console.log(`   ${CODE_MAIN} after deactivation: ${res.status} ${res.json.message}`);
});

// ---------------------------------------------------------------------------
// Cleanup: DB rows removed (verified), Stripe objects deactivated (ids printed)
// ---------------------------------------------------------------------------

await section("(cleanup) tesztsorok törlése + Stripe objektumok inaktiválása", async () => {
  // EVERY order of the throwaway concert (order A, order B and the two
  // pending rows the stubbed param check inserted) — tickets cascade.
  const { data: concertOrders } = await supabase
    .from("rk_orders")
    .select("id")
    .eq("concert_id", CONCERT_ID);
  for (const row of concertOrders ?? []) {
    await deleteVerified("rk_orders", "id", row.id);
  }
  console.log(`   DB: ${(concertOrders ?? []).length} rendelés törölve (a jegyek kaszkádosan)`);
  await deleteVerified("rk_ticket_types", "concert_id", CONCERT_ID);
  await deleteVerified("rk_concerts", "concert_id", CONCERT_ID);
  console.log(`   DB: jegytípusok és a koncert (${CONCERT_ID}) törölve`);

  // Discount rows (history is never deleted in production; these are throwaway test rows).
  for (const code of created.codeRows) {
    const row = await dbDiscountRow(code);
    if (row) await deleteVerified("rk_discount_codes", "id", row.id);
  }
  const { data: left } = await supabase.from("rk_discount_codes").select("code").like("code", "TESZT%");
  assert.equal((left ?? []).length, 0, "all test discount rows must be gone");
  console.log(`   DB: ${created.codeRows.length} kedvezménykód sor törölve (${created.codeRows.join(", ")})`);

  // Nothing is left of the fixture in the DB.
  const { data: leftoverTickets } = await supabase.from("rk_tickets").select("id").eq("concert_id", CONCERT_ID);
  assert.equal((leftoverTickets ?? []).length, 0, "no ticket rows may survive the cleanup");

  // Stripe objects: deactivate every promotion code (the redeemable gate),
  // deactivate the price, archive the product. Coupon objects have no active
  // flag in Stripe's API — with their promotion code inactive they are inert;
  // their ids are printed for a Dashboard purge.
  for (const promoId of created.promoIds) {
    await stripe.promotionCodes.update(promoId, { active: false });
    console.log(`   Stripe promotion code inaktiválva: ${promoId}`);
  }
  for (const couponId of created.couponIds) {
    console.log(`   Stripe coupon (nincs active kapcsoló az API-ban, inaktív promotion code mögött inert): ${couponId}`);
  }
  await stripe.prices.update(realPriceId, { active: false });
  await stripe.products.update(realProductId, { active: false });
  console.log(`   Stripe price inaktiválva: ${realPriceId}`);
  console.log(`   Stripe product archiválva: ${realProductId}`);
  console.log(`   (a ${orderA.sessionId} session soha nem lett kifizetve — magától lejár)`);
});

// ---------------------------------------------------------------------------

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `FAILED SECTIONS: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
