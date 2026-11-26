// Verification harness for card 03 (Stripe checkout, webhook, tickets, ticket e-mail).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/ticket-flow-check.mjs
//
// STRIPE_SECRET_KEY is LIVE (sk_live_) on this account — the owner's rule:
// never create a real Checkout Session, never take a payment, never send a
// real refund or charge. Therefore the Stripe WRITE calls are STUBBED while
// every DB/route/e-mail step is real:
//
//  - checkout validation rejections (a: terms, empty items, qty>6, unknown
//    type, unknown concert, e: sold_out, and not_on_sale after sold_out) run
//    against the REAL route — validation happens before any Stripe call, so
//    no session is ever created.
//  - the session-building success path (b, orders A/B/C) runs through the
//    SAME shared lib function the route calls (createOrderAndCheckoutSession)
//    with a stubbed Stripe client, per the owner's instruction for the live
//    key. The stub resolves amount_total from the LIVE Stripe prices
//    (prices.retrieve, inert read) — proving the session amount ties back to
//    the DB price.
//  - the webhook (c/d/i) is the REAL route on the dev server: raw body signed
//    with the real STRIPE_TICKET_WEBHOOK_SECRET via
//    stripe.webhooks.generateTestHeaderString. Real signature verification,
//    real DB writes, real ticket e-mail through Purelymail SMTP (sent to
//    ORDER_CC only — never an invented buyer address).
//  - the refund success path (g) runs through the same shared function the
//    intern route calls (refundPaidOrder) with a stubbed Stripe client; the
//    intern route itself is driven real for 401/400/404/pending/already-
//    refunded (none of those touch Stripe).
//
// Proofs (per the card):
//   a) accept_terms:false → 400 terms_required (+ empty items, qty 7,
//      unknown type, unknown concert → 400/404)
//   b) client-supplied wrong price → session amount_total still equals the
//      DB price (amount_total printed; session params asserted)
//   c) signed checkout.session.completed (payment_status:"paid") → 200,
//      order paid, N unique 10-char ticket codes printed, sold incremented
//   d) replay the identical event → still exactly N tickets (idempotent)
//   d2) manual "re-fetch session" path (fetchSessionAndFulfil) → idempotent
//   e) over-capacity checkout → 409 sold_out with the type name
//   f) e-mail: SMTP accepted/rejected printed, emailed_at stamped
//   g) refund: Stripe refund id printed (stub), order refunded, tickets void;
//      intern route 401/400/404/pending/idempotent-note all real
//   h) second order pushes every active type to capacity → concert sold_out
//   i) charge.refunded webhook branch → order refunded, tickets void
//
// Out of scope (later cards, noted per the card text): the resend route
// POST /api/intern/orders/[id]/resend; TACITo invoicing (card 04); pages.

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
const WEBHOOK_SECRET = env("STRIPE_TICKET_WEBHOOK_SECRET");
const ORDER_CC = env("ORDER_CC");
const stripeMode = STRIPE_KEY ? (STRIPE_KEY.startsWith("sk_live_") ? "live" : "test") : null;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
assert.ok(STRIPE_KEY, "STRIPE_SECRET_KEY must be in .env.local");
assert.ok(WEBHOOK_SECRET, "STRIPE_TICKET_WEBHOOK_SECRET must be in .env.local");
assert.ok(ORDER_CC, "ORDER_CC must be in .env.local");
assert.ok(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"), "SMTP_* must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`Stripe key mode: ${stripeMode}${stripeMode === "live" ? " (session/refund writes STUBBED — no real Checkout Session, payment or refund)" : ""}`);
console.log(`Webhook secret: present (${WEBHOOK_SECRET.length} chars, not printed)`);
console.log(`SMTP host: ${env("SMTP_HOST")}; buyer e-mail for this run: ${ORDER_CC} (ORDER_CC — no invented address)`);

// Seed process.env for the imported server libs (lib/ticket-db reads process.env).
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_TICKET_WEBHOOK_SECRET",
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
// "@" alias hook + server lib imports (same style as card 01/02 harnesses)
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

const checkout = await import("../lib/ticket-checkout.ts");
const fulfil = await import("../lib/ticket-fulfil.ts");
const ticketCode = await import("../lib/ticket-code.ts");
const emailLib = await import("../lib/ticket-email.ts");
const admin = await import("../lib/concert-admin.ts");

// ---------------------------------------------------------------------------
// Stubbed Stripe client (the live key must never create a session or refund)
// ---------------------------------------------------------------------------

function makeStubStripe(liveStripe) {
  const recorded = { sessions: [], refunds: [], retrieves: [] };
  const store = new Map();
  let n = 0;

  const stub = {
    recorded,
    /** The harness parks a crafted session here before fetchSessionAndFulfil. */
    stashSession(session) {
      store.set(session.id, session);
    },
    checkout: {
      sessions: {
        async create(params) {
          n += 1;
          const id = `cs_stub_${n}`;
          // Resolve amount_total from the LIVE Stripe prices (inert read) —
          // this is what real Stripe would compute from these line items.
          const lines = [];
          for (const li of params.line_items ?? []) {
            const price = await liveStripe.prices.retrieve(li.price);
            lines.push({ price_id: li.price, quantity: li.quantity, unit_amount: price.unit_amount });
          }
          const amountTotal = lines.reduce((sum, line) => sum + line.unit_amount * line.quantity, 0);
          recorded.sessions.push({ id, params, lines, amountTotal });
          return {
            id,
            object: "checkout.session",
            mode: "payment",
            payment_status: "unpaid",
            amount_total: amountTotal,
            currency: "huf",
            url: `https://checkout.stripe.com/c/pay_stub_${n}`,
          };
        },
        async retrieve(sessionId) {
          n += 1;
          recorded.retrieves.push(sessionId);
          const session = store.get(sessionId);
          if (!session) throw new Error(`stub Stripe: no stashed session ${sessionId}`);
          return session;
        },
      },
    },
    refunds: {
      async create(params) {
        n += 1;
        const id = `re_stub_${n}`;
        recorded.refunds.push({ id, params });
        return { id, object: "refund", status: "succeeded" };
      },
    },
  };
  return stub;
}

const stubStripe = makeStubStripe(stripe);

// ---------------------------------------------------------------------------
// HTTP + DB helpers
// ---------------------------------------------------------------------------

async function api(method, path, body, { withCookie = false } = {}) {
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

let eventCount = 0;
function makeEvent(type, object) {
  eventCount += 1;
  return {
    id: `evt_stub_${eventCount}`,
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

async function postWebhook(event, { signature } = {}) {
  const raw = JSON.stringify(event);
  const sig =
    signature ??
    stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET });
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
  return { status: res.status, json, raw, sig };
}

async function dbConcert(id) {
  const { data, error } = await supabase.from("rk_concerts").select("*").eq("concert_id", id).single();
  if (error) throw new Error(`rk_concerts read failed: ${error.message}`);
  return data;
}

async function dbTypes(concertId) {
  const { data, error } = await supabase
    .from("rk_ticket_types")
    .select("*")
    .eq("concert_id", concertId)
    .order("sort");
  if (error) throw new Error(`rk_ticket_types read failed: ${error.message}`);
  return data ?? [];
}

async function dbOrder(id) {
  const { data, error } = await supabase.from("rk_orders").select("*").eq("id", id).single();
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

async function dbOrderIds(concertId) {
  const { data, error } = await supabase.from("rk_orders").select("id").eq("concert_id", concertId);
  if (error) throw new Error(`rk_orders id read failed: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

// A checkout buyer that is only ever the owner's own mailbox (ORDER_CC).
function testBuyer() {
  return {
    name: "Teszt Vásárló",
    email: ORDER_CC,
    phone: "",
    address: { postal_code: "1234", city: "Tesztváros", street: "Teszt utca 1." },
  };
}

/** Drives the same shared lib the route calls — with the stubbed Stripe client. */
async function stubCheckout({ items, buyer = testBuyer() }) {
  const parsed = checkout.parseCheckoutRequest({
    concert_id: concertId,
    items,
    buyer,
    accept_terms: true,
  });
  assert.ok(parsed.request, `parseCheckoutRequest rejected a valid payload: ${parsed.error}`);
  return checkout.createOrderAndCheckoutSession(stubStripe, parsed.request, "https://rezkorut.hu");
}

function makeSessionObject(checkoutResult, { paymentIntent, buyer }) {
  const sessionFromStub = stubStripe.recorded.sessions.find((entry) => entry.id === checkoutResult.sessionId);
  assert.ok(sessionFromStub, "the stub must have recorded this session");
  return {
    id: checkoutResult.sessionId,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: sessionFromStub.amountTotal,
    currency: "huf",
    client_reference_id: checkoutResult.orderId,
    metadata: { order_id: checkoutResult.orderId, concert_id: concertId },
    payment_intent: paymentIntent,
    customer_details: {
      name: buyer.name,
      email: buyer.email,
      phone: "+36 30 111 2233",
      address: { city: "Weblapváros", country: "HU", line1: "Webes utca 9.", postal_code: "9999" },
    },
    line_items: {
      object: "list",
      total_count: checkoutResult.lineItems.length,
      has_more: false,
      data: checkoutResult.lineItems.map((li, index) => ({
        id: `li_stub_${index + 1}`,
        object: "item",
        quantity: li.quantity,
        price: { id: li.priceId, object: "price" },
      })),
    },
  };
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

// ---------------------------------------------------------------------------
// Throwaway concert data
// ---------------------------------------------------------------------------

const HU_MONTHS = ["január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december"];
const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
const futureIsoDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
const THROWAWAY_TITLE = "Teszt – törlendő";

let concertId = null;
let koraiId = null;
let normalId = null;
let orders = {}; // A, B, C → {orderId, sessionId, amount}

let baselineConcertCount = null;

// ---------------------------------------------------------------------------
// Pre-clean leftovers of crashed runs (tickets → orders → concert; S3 lines)
// ---------------------------------------------------------------------------

async function deleteThrowawayConcerts() {
  const { data: leftovers, error } = await supabase
    .from("rk_concerts")
    .select("concert_id,title")
    .like("title", "Teszt – törlendő%");
  if (error) throw new Error(`rk_concerts select failed: ${error.message}`);
  const removed = [];
  for (const row of leftovers ?? []) {
    const { data: tickets } = await supabase
      .from("rk_tickets")
      .select("id")
      .eq("concert_id", row.concert_id);
    if ((tickets ?? []).length) {
      const delTickets = await supabase.from("rk_tickets").delete().eq("concert_id", row.concert_id);
      if (delTickets.error) throw new Error(`rk_tickets delete failed: ${delTickets.error.message}`);
    }
    const { data: orderIds } = await supabase
      .from("rk_orders")
      .select("id")
      .eq("concert_id", row.concert_id);
    if ((orderIds ?? []).length) {
      const delOrders = await supabase.from("rk_orders").delete().eq("concert_id", row.concert_id);
      if (delOrders.error) throw new Error(`rk_orders delete failed: ${delOrders.error.message}`);
    }
    const del = await supabase.from("rk_concerts").delete().eq("concert_id", row.concert_id);
    if (del.error) throw new Error(`rk_concerts delete failed: ${del.error.message}`);
    removed.push(row.concert_id);
  }
  // S3 lines of crashed runs
  for (const concert of await admin.listUpcomingConcerts()) {
    if (concert.title === THROWAWAY_TITLE) {
      if (!concert.id) continue;
      await admin.deleteConcert(concert.id);
      removed.push(`${concert.id} (S3 line)`);
    }
  }
  return removed;
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
  baselineConcertCount = (await admin.listUpcomingConcerts()).length;
  console.log(`   baseline S3 concert lines: ${baselineConcertCount}`);

  const removed = await deleteThrowawayConcerts();
  console.log(`   old leftovers removed: ${removed.length ? removed.join(", ") : "none"}`);
});

await section("(setup) recreate the throwaway concert: 2 types, published", async () => {
  const res = await api("POST", "/api/intern/koncertek", {
    date: futureIsoDate,
    time: "19:00",
    location: "Teszt város",
    venue: "Teszt terem",
    title: THROWAWAY_TITLE,
    program: ["Teszt szerző: Teszt mű"],
  }, { withCookie: true });
  console.log(`   POST concert: ${res.status}`);
  assert.equal(res.status, 200, `POST failed: ${JSON.stringify(res.json)}`);
  concertId = res.json?.concert?.id;
  assert.ok(concertId, "the created concert must have an id");
  assert.equal(res.json?.ticketing?.status, "draft");
  console.log(`   concert id: ${concertId}`);

  const put = await api("PUT", `/api/intern/koncertek/${concertId}/ticket-types`, {
    types: [
      { name: "Korai madár", kind: "early_bird", price_huf: 2000, capacity: 3, active: true, sort: 0 },
      { name: "Normál", kind: "standard", price_huf: 3000, capacity: 2, active: true, sort: 1 },
    ],
  }, { withCookie: true });
  assert.equal(put.status, 200, `PUT ticket types failed: ${JSON.stringify(put.json)}`);
  assert.equal(put.json?.types?.length, 2);
  for (const type of put.json.types) {
    assert.ok(type.stripe_price_id, `type ${type.name} must carry a stripe_price_id`);
    if (type.name === "Korai madár") koraiId = type.id;
    if (type.name === "Normál") normalId = type.id;
  }
  assert.ok(koraiId && normalId, "both type ids must be captured");
  const rows = await dbTypes(concertId);
  console.log(`   rk_ticket_types (live Stripe price upsert, inert objects):`);
  for (const row of rows) console.log(`     ${row.name} | ${row.price_huf} Ft | cap ${row.capacity} | price ${row.stripe_price_id} | key ${row.stripe_lookup_key}`);

  const publish = await api("POST", `/api/intern/koncertek/${concertId}/publish`, {}, { withCookie: true });
  assert.equal(publish.status, 200, `publish failed: ${JSON.stringify(publish.json)}`);
  assert.equal(publish.json?.concert?.status, "on_sale");
  console.log(`   concert status: on_sale`);
});

await section("(a) checkout rejections through the real route (no Stripe call)", async () => {
  const buyer = testBuyer();

  const terms = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [{ ticket_type_id: koraiId, quantity: 1 }],
    buyer,
    accept_terms: false,
  });
  console.log(`   accept_terms:false → ${terms.status} ${JSON.stringify(terms.json)}`);
  assert.equal(terms.status, 400, "must be 400 without accepting the terms");
  assert.equal(terms.json?.error, "terms_required", "the error code must be terms_required");
  assert.notEqual(terms.status, 401, "the checkout route is public — no intern cookie needed");

  const empty = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [],
    buyer,
    accept_terms: true,
  });
  console.log(`   empty items → ${empty.status} ${JSON.stringify(empty.json)}`);
  assert.equal(empty.status, 400);

  const tooMany = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [{ ticket_type_id: koraiId, quantity: 4 }, { ticket_type_id: normalId, quantity: 3 }],
    buyer,
    accept_terms: true,
  });
  console.log(`   quantity 7 → ${tooMany.status} ${JSON.stringify(tooMany.json)}`);
  assert.equal(tooMany.status, 400, "more than 6 tickets in one order must be rejected");

  const unknownType = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [{ ticket_type_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
    buyer,
    accept_terms: true,
  });
  console.log(`   unknown ticket type → ${unknownType.status} ${JSON.stringify(unknownType.json)}`);
  assert.equal(unknownType.status, 400);

  const unknownConcert = await api("POST", "/api/tickets/checkout", {
    concert_id: "rk-nonexistent-concert",
    items: [{ ticket_type_id: koraiId, quantity: 1 }],
    buyer,
    accept_terms: true,
  });
  console.log(`   unknown concert → ${unknownConcert.status} ${JSON.stringify(unknownConcert.json)}`);
  assert.equal(unknownConcert.status, 404);

  const noOrder = await dbOrderIds(concertId);
  assert.equal(noOrder.length, 0, "no order row may exist after the rejections");
});

await section("(b) wrong client price → session amount_total equals the DB price", async () => {
  // Order A: 2× Korai madár (2000 Ft) + 1× Normál (3000 Ft) — the client sends
  // junk prices which the server must never read.
  orders.A = await stubCheckout({
    items: [
      { ticket_type_id: koraiId, quantity: 2, price: 1 },
      { ticket_type_id: normalId, quantity: 1, price: 999 },
    ],
  });
  const expectedFromDb = 2 * 2000 + 1 * 3000;

  const session = stubStripe.recorded.sessions[stubStripe.recorded.sessions.length - 1];
  console.log(`   session amount_total (from the live Stripe prices): ${session.amountTotal} (fillér: ${session.amountTotal / 100} Ft)`);
  console.log(`   session id: ${session.id} | url: ${"https://checkout.stripe.com/…"}`);
  for (const line of session.lines) {
    console.log(`   line: ${line.quantity} × price ${line.price_id} (unit_amount ${line.unit_amount})`);
  }

  assert.equal(session.amountTotal / 100, expectedFromDb, "amount_total must equal the DB price total");
  for (const line of session.lines) {
    assert.equal(
      line.unit_amount % 100,
      0,
      "the unit amount must be a whole forint in fillér (HUF has no minor unit in practice)",
    );
  }
  assert.equal(session.lines[0].unit_amount, 2000 * 100, "line 1 must be the 2000 Ft price (not the client's junk 1)");
  assert.equal(session.lines[1].unit_amount, 3000 * 100, "line 2 must be the 3000 Ft price (not the client's junk 999)");

  const params = session.params;
  assert.equal(params.mode, "payment");
  assert.equal(params.customer_creation, "always");
  assert.equal(params.billing_address_collection, "required");
  assert.deepEqual(params.phone_number_collection, { enabled: true });
  assert.deepEqual(params.consent_collection, { terms_of_service: "required" });
  assert.equal(params.locale, "hu");
  assert.equal(params.metadata.order_id, orders.A.orderId, "session metadata must carry order_id");
  assert.equal(params.metadata.concert_id, concertId, "session metadata must carry concert_id");
  assert.deepEqual(
    params.payment_intent_data?.metadata,
    { order_id: orders.A.orderId },
    "payment_intent_data.metadata must carry order_id",
  );
  assert.equal(
    params.success_url,
    "https://rezkorut.hu/jegyek/koszonjuk?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(params.cancel_url, `https://rezkorut.hu/jegyek/${concertId}?canceled=1`);
  for (const li of params.line_items) {
    assert.deepEqual(
      Object.keys(li).sort(),
      ["price", "quantity"],
      "line items must carry only price+quantity — no client price may leak",
    );
  }

  const order = await dbOrder(orders.A.orderId);
  console.log(`   rk_orders row: status ${order.status} | amount_huf ${order.amount_huf} | session ${order.stripe_session_id}`);
  assert.equal(order.status, "pending");
  assert.equal(order.amount_huf, expectedFromDb, "the stored amount must be the recomputed DB total");
  assert.equal(order.stripe_session_id, orders.A.sessionId);
  assert.equal(order.buyer_company, null, "buyer_company must never be written (private buyers only)");
  assert.equal(order.buyer_tax_number, null, "buyer_tax_number must never be written (private buyers only)");
  assert.equal(order.buyer_name, "Teszt Vásárló");
  assert.equal(order.buyer_email, ORDER_CC);
  console.log("   buyer_company / buyer_tax_number: both null (owner decision: private buyers only)");
});

await section("(c) signed webhook → order paid, 3 tickets, sold incremented, e-mail sent", async () => {
  const buyer = testBuyer();
  const sessionObject = makeSessionObject(orders.A, { paymentIntent: "pi_stub_A", buyer });
  const event = makeEvent("checkout.session.completed", sessionObject);
  const res = await postWebhook(event);
  console.log(`   webhook status: ${res.status}`);
  console.log(`   webhook body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200, "the signed webhook must answer 200");
  assert.equal(res.json?.received, true);
  assert.equal(res.json?.fulfil?.outcome, "fulfilled");
  assert.equal(res.json?.fulfil?.ticket_count, 3);

  const order = await dbOrder(orders.A.orderId);
  console.log(`   order: status ${order.status} | paid_at ${order.paid_at} | payment_intent ${order.stripe_payment_intent}`);
  assert.equal(order.status, "paid");
  assert.ok(order.paid_at, "paid_at must be stamped");
  assert.equal(order.stripe_payment_intent, "pi_stub_A", "the payment intent must be stored");
  assert.equal(order.buyer_phone, "+36 30 111 2233", "the empty phone must be enriched from customer_details");
  assert.equal(order.address_city, "Tesztváros", "a form-provided city must NOT be overwritten");

  const tickets = await dbTickets(orders.A.orderId);
  assert.equal(tickets.length, 3, "exactly 3 tickets (2 Korai madár + 1 Normál)");
  const codes = new Set();
  for (const ticket of tickets) {
    assert.match(ticket.code, /^[0-9A-Z]{10}$/, `code ${ticket.code} must be 10 Crockford base32 chars`);
    assert.ok(!/[ILOU]/.test(ticket.code), `code ${ticket.code} must not contain I/L/O/U`);
    assert.ok(ticketCode.isValidCode(ticket.code), "the code must validate through lib/ticket-code");
    codes.add(ticket.code);
    console.log(
      `   ticket: ${ticket.ticket_type_name} | ${ticket.price_huf} Ft | code ${ticket.code} | status ${ticket.status} | emailed_at ${ticket.emailed_at ? "stamped" : "NULL"}`,
    );
  }
  assert.equal(codes.size, 3, "all 3 codes must be unique");

  const types = await dbTypes(concertId);
  const korai = types.find((type) => type.id === koraiId);
  const normal = types.find((type) => type.id === normalId);
  console.log(`   sold after fulfilment: Korai madár ${korai.sold}/${korai.capacity}, Normál ${normal.sold}/${normal.capacity}`);
  assert.equal(korai.sold, 2, "Korai madár sold must be incremented by 2");
  assert.equal(normal.sold, 1, "Normál sold must be incremented by 1");

  // (f) the SMTP result of the ticket e-mail, printed:
  const email = res.json?.fulfil?.email;
  console.log(`   (f) e-mail ok: ${email?.ok} | accepted: ${JSON.stringify(email?.accepted)} | rejected: ${JSON.stringify(email?.rejected)} | message id: ${email?.messageId}`);
  assert.equal(email?.ok, true, "the ticket e-mail must have been sent");
  assert.ok(email?.accepted?.includes(ORDER_CC), "the recipient must be ORDER_CC (never an invented address)");
  assert.equal(email?.rejected?.length, 0, "the recipient must not be rejected");

  const stamped = tickets.every((ticket) => ticket.emailed_at);
  assert.ok(stamped, "every ticket of the order must carry emailed_at");

  // E-mail content: built by the same pure builders the fulfilment used.
  const concert = await dbConcert(concertId);
  const data = {
    orderId: orders.A.orderId,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    concert: {
      title: concert.title,
      event_date: concert.event_date,
      event_time: concert.event_time,
      venue: concert.venue,
      location: concert.location,
    },
    tickets: tickets.map((ticket) => ({
      code: ticket.code,
      ticket_type_name: ticket.ticket_type_name,
      price_huf: ticket.price_huf,
    })),
  };
  const html = emailLib.buildTicketEmailHtml(data);
  const text = emailLib.buildTicketEmailText(data);
  for (const ticket of tickets) {
    assert.ok(html.includes(ticket.code), "the HTML must show the code");
    assert.ok(html.includes(emailLib.ticketUrl(ticket.code)), "the HTML must carry the /j/<code> link");
    assert.ok(text.includes(ticket.code), "the text part must show the code");
  }
  assert.ok(html.includes("Ez a levél nem számla"), "the e-mail must say it is not the invoice");
  assert.ok(text.includes("számlát a számlázási rendszerünktől"), "the e-mail must say the számla arrives separately");
  const emoji = /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u;
  assert.ok(!emoji.test(html) && !emoji.test(text), "the e-mail must not contain emoji");
  assert.ok(concert.title.length > 0 && html.includes(concert.title), "the e-mail must carry the concert title");
});

await section("(d) replay the identical event → still exactly 3 tickets (idempotent)", async () => {
  const before = await dbTickets(orders.A.orderId);
  const beforeEmailed = before.map((ticket) => ticket.emailed_at).join(",");
  const typesBefore = await dbTypes(concertId);

  const sessionObject = makeSessionObject(orders.A, { paymentIntent: "pi_stub_A", buyer: testBuyer() });
  const event = makeEvent("checkout.session.completed", sessionObject);
  const res = await postWebhook(event);
  console.log(`   replay status: ${res.status} | body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200);
  assert.equal(res.json?.fulfil?.outcome, "already_fulfilled", "the replay must hit the idempotency branch");
  assert.equal(res.json?.fulfil?.ticket_count, 3);

  const after = await dbTickets(orders.A.orderId);
  assert.equal(after.length, 3, "still exactly 3 tickets — no duplicates");
  assert.equal(
    after.map((ticket) => ticket.emailed_at).join(","),
    beforeEmailed,
    "the e-mail must not be re-sent",
  );
  const typesAfter = await dbTypes(concertId);
  for (const type of typesAfter) {
    const was = typesBefore.find((row) => row.id === type.id);
    assert.equal(type.sold, was.sold, `sold of ${type.name} must not be double-incremented`);
  }
});

await section("(d2) manual re-fetch session path (fetchSessionAndFulfil) → idempotent", async () => {
  const sessionObject = makeSessionObject(orders.A, { paymentIntent: "pi_stub_A", buyer: testBuyer() });
  stubStripe.stashSession(sessionObject);
  const result = await fulfil.fetchSessionAndFulfil(stubStripe, sessionObject.id);
  console.log(`   fetchSessionAndFulfil outcome: ${result.outcome} (tickets: ${result.ticketCount})`);
  assert.equal(result.outcome, "already_fulfilled", "the re-fetched session must be recognised as already fulfilled");
  assert.equal(result.ticketCount, 3);
  assert.ok(
    stubStripe.recorded.retrieves.includes(sessionObject.id),
    "the session must have been retrieved with line_items expanded",
  );
});

await section("(e) over-capacity checkout → 409 sold_out with the type name", async () => {
  // Korai madár: sold 2, capacity 3 — asking for 2 more must fail.
  const res = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [{ ticket_type_id: koraiId, quantity: 2 }],
    buyer: testBuyer(),
    accept_terms: true,
  });
  console.log(`   status: ${res.status} | body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 409, "the over-capacity checkout must be 409");
  assert.equal(res.json?.error, "sold_out");
  assert.equal(res.json?.ticket_type, "Korai madár", "the 409 must carry the type name");
  const orderIds = await dbOrderIds(concertId);
  assert.equal(orderIds.length, 1, "no new order row may be created by the rejected checkout");
});

await section("(g) refund — negative real-route proofs first (no Stripe involved)", async () => {
  // Order C: 1× Normál, stays pending (created through the shared lib + stub).
  orders.C = await stubCheckout({ items: [{ ticket_type_id: normalId, quantity: 1, price: 5 }] });
  console.log(`   order C: ${orders.C.orderId} (pending, stub session ${orders.C.sessionId})`);

  const noCookie = await api("POST", `/api/intern/orders/${orders.C.orderId}/refund`, { reason: "cancelled" });
  console.log(`   no cookie → ${noCookie.status}`);
  assert.equal(noCookie.status, 401);

  const badReason = await api("POST", `/api/intern/orders/${orders.C.orderId}/refund`, { reason: "because" }, { withCookie: true });
  console.log(`   bad reason → ${badReason.status} ${JSON.stringify(badReason.json)}`);
  assert.equal(badReason.status, 400);

  const unknown = await api("POST", "/api/intern/orders/00000000-0000-4000-8000-000000000001/refund", { reason: "cancelled" }, { withCookie: true });
  console.log(`   unknown order → ${unknown.status}`);
  assert.equal(unknown.status, 404);

  const pending = await api("POST", `/api/intern/orders/${orders.C.orderId}/refund`, { reason: "cancelled" }, { withCookie: true });
  console.log(`   pending order → ${pending.status} ${JSON.stringify(pending.json)}`);
  assert.equal(pending.status, 400, "a pending order must not be refundable through the route");
});

await section("(g) refund order A through the shared intern-refund path (stubbed Stripe call)", async () => {
  // The intern route's body is this exact shared function; with the live key
  // a real refunds.create would hit Stripe with a stub payment intent, which
  // is forbidden — so the Stripe call is stubbed here.
  const result = await fulfil.refundPaidOrder(stubStripe, orders.A.orderId, "cancelled");
  console.log(`   outcome: ${result.outcome} | refund id: ${result.refundId} | tickets void: ${result.voided}`);
  assert.equal(result.outcome, "refunded");
  assert.match(result.refundId, /^re_stub_/, "the (stubbed) Stripe refund id must be printed");
  assert.equal(result.voided, 3);

  const recorded = stubStripe.recorded.refunds[stubStripe.recorded.refunds.length - 1];
  console.log(`   stripe.refunds.create params: ${JSON.stringify(recorded.params)}`);
  assert.equal(recorded.params.payment_intent, "pi_stub_A");
  assert.equal(recorded.params.reason, "requested_by_customer");
  assert.equal(recorded.params.amount, undefined, "no amount → FULL refund only");
  assert.equal(recorded.params.refund_application_fee, undefined);

  const order = await dbOrder(orders.A.orderId);
  console.log(`   order A: status ${order.status} | refunded_at ${order.refunded_at}`);
  assert.equal(order.status, "refunded");
  assert.ok(order.refunded_at, "refunded_at must be stamped");
  const tickets = await dbTickets(orders.A.orderId);
  for (const ticket of tickets) {
    assert.equal(ticket.status, "void", `ticket ${ticket.code} must be void`);
  }
  console.log(`   ${tickets.length} tickets of order A: all void`);

  // The real route now reports idempotency without touching Stripe:
  const again = await api("POST", `/api/intern/orders/${orders.A.orderId}/refund`, { reason: "cancelled" }, { withCookie: true });
  console.log(`   real route on the already-refunded order → ${again.status} ${JSON.stringify(again.json?.note ? { ok: again.json.ok, note: again.json.note } : again.json)}`);
  assert.equal(again.status, 200);
  assert.equal(again.json?.ok, true);
  assert.ok(again.json?.note, "an already-refunded order must answer 200 with a note");
});

await section("(h) order B pushes every active type to capacity → concert sold_out", async () => {
  // Sold now: Korai 2/3, Normál 1/2. Order B: 1× each → 3/3 and 2/2.
  orders.B = await stubCheckout({
    items: [
      { ticket_type_id: koraiId, quantity: 1, price: 123 },
      { ticket_type_id: normalId, quantity: 1, price: 456 },
    ],
  });
  const event = makeEvent(
    "checkout.session.completed",
    makeSessionObject(orders.B, { paymentIntent: "pi_stub_B", buyer: testBuyer() }),
  );
  const res = await postWebhook(event);
  console.log(`   webhook status: ${res.status} | fulfil: ${JSON.stringify(res.json?.fulfil?.outcome)}, tickets ${res.json?.fulfil?.ticket_count}`);
  assert.equal(res.status, 200);
  assert.equal(res.json?.fulfil?.outcome, "fulfilled");
  assert.equal(res.json?.fulfil?.ticket_count, 2);
  console.log(`   (f) e-mail ok: ${res.json?.fulfil?.email?.ok} | accepted: ${JSON.stringify(res.json?.fulfil?.email?.accepted)} | rejected: ${JSON.stringify(res.json?.fulfil?.email?.rejected)}`);
  assert.equal(res.json?.fulfil?.email?.ok, true);

  const types = await dbTypes(concertId);
  const korai = types.find((type) => type.id === koraiId);
  const normal = types.find((type) => type.id === normalId);
  console.log(`   sold: Korai madár ${korai.sold}/${korai.capacity}, Normál ${normal.sold}/${normal.capacity}`);
  assert.equal(korai.sold, 3);
  assert.equal(normal.sold, 2);

  const concert = await dbConcert(concertId);
  console.log(`   concert status: ${concert.status}`);
  assert.equal(concert.status, "sold_out", "the concert must flip to sold_out when every active type is at capacity");

  // Once not on_sale, checkout must be rejected:
  const res2 = await api("POST", "/api/tickets/checkout", {
    concert_id: concertId,
    items: [{ ticket_type_id: normalId, quantity: 1 }],
    buyer: testBuyer(),
    accept_terms: true,
  });
  console.log(`   checkout on sold_out concert → ${res2.status} ${JSON.stringify(res2.json)}`);
  assert.equal(res2.status, 409);
  assert.equal(res2.json?.error, "not_on_sale");
});

await section("(i) charge.refunded webhook branch (order B) + signature/gate negatives", async () => {
  const charge = {
    object: "charge",
    payment_intent: "pi_stub_B",
    amount: 5000,
    amount_refunded: 5000,
    refunded: true,
    status: "succeeded",
  };
  const res = await postWebhook(makeEvent("charge.refunded", charge));
  console.log(`   charge.refunded → ${res.status} | body: ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 200);
  assert.equal(res.json?.refund?.order_id, orders.B.orderId);
  assert.equal(res.json?.refund?.voided, 2);

  const orderB = await dbOrder(orders.B.orderId);
  assert.equal(orderB.status, "refunded", "order B must be refunded by the webhook branch");
  const ticketsB = await dbTickets(orders.B.orderId);
  assert.ok(ticketsB.every((ticket) => ticket.status === "void"), "order B tickets must be void");

  // Replay the same charge.refunded → idempotent, still 2 void tickets.
  const replay = await postWebhook(makeEvent("charge.refunded", charge));
  assert.equal(replay.status, 200);
  const ticketsAfterReplay = await dbTickets(orders.B.orderId);
  assert.equal(ticketsAfterReplay.length, 2, "replaying must not duplicate anything");

  // Unknown payment intent → 200, no match.
  const noMatch = await postWebhook(
    makeEvent("charge.refunded", { object: "charge", payment_intent: "pi_unknown_1", refunded: true, status: "succeeded" }),
  );
  console.log(`   charge.refunded unknown pi → ${noMatch.status} | body: ${JSON.stringify(noMatch.json)}`);
  assert.equal(noMatch.status, 200);
  assert.equal(noMatch.json?.refund, null);

  // Bad signature → 400.
  const badSig = await postWebhook(makeEvent("charge.refunded", charge), { signature: "t=1,v1=deadbeef" });
  console.log(`   bad signature → ${badSig.status} ${JSON.stringify(badSig.json)}`);
  assert.equal(badSig.status, 400);
  assert.equal(badSig.json?.error, "bad_signature");

  // completed with payment_status "unpaid" → ignored, order C stays pending.
  const unpaidSession = makeSessionObject(orders.C, { paymentIntent: "pi_stub_C", buyer: testBuyer() });
  unpaidSession.payment_status = "unpaid";
  const unpaid = await postWebhook(makeEvent("checkout.session.completed", unpaidSession));
  console.log(`   completed with payment_status "unpaid" → ${unpaid.status} | body: ${JSON.stringify(unpaid.json)}`);
  assert.equal(unpaid.status, 200);
  const orderC = await dbOrder(orders.C.orderId);
  assert.equal(orderC.status, "pending", "an unpaid session must not be fulfilled");
});

await section("(cleanup) delete the throwaway concert, orders, tickets; inert Stripe leftovers", async () => {
  // --- Supabase rows (print every deleted id) ---
  const delTickets = await supabase.from("rk_tickets").delete().eq("concert_id", concertId).select("id");
  assert.ok(!delTickets.error, `rk_tickets delete failed: ${delTickets.error?.message}`);
  console.log(`   deleted rk_tickets (${delTickets.data?.length ?? 0}): ${(delTickets.data ?? []).map((row) => row.id).join(", ")}`);

  const delOrders = await supabase.from("rk_orders").delete().eq("concert_id", concertId).select("id");
  assert.ok(!delOrders.error, `rk_orders delete failed: ${delOrders.error?.message}`);
  console.log(`   deleted rk_orders (${delOrders.data?.length ?? 0}): ${(delOrders.data ?? []).map((row) => row.id).join(", ")}`);
  assert.deepEqual(
    (delOrders.data ?? []).map((row) => row.id).sort(),
    [orders.A.orderId, orders.B.orderId, orders.C.orderId].sort(),
    "exactly orders A, B and C must be deleted",
  );

  const typesBefore = await dbTypes(concertId);
  const delConcert = await supabase.from("rk_concerts").delete().eq("concert_id", concertId).select("concert_id");
  assert.ok(!delConcert.error, `rk_concerts delete failed: ${delConcert.error?.message}`);
  console.log(`   deleted rk_concerts: ${delConcert.data?.map((row) => row.concert_id).join(", ")}`);
  console.log(
    `   rk_ticket_types cascaded away with the concert (${typesBefore.length} rows: ${typesBefore.map((type) => `${type.id} (${type.name})`).join(", ")})`,
  );

  // --- S3 line ---
  await admin.deleteConcert(concertId);
  const remaining = await admin.listUpcomingConcerts();
  assert.ok(!remaining.some((concert) => concert.id === concertId), "the S3 line must be gone");
  assert.equal(remaining.length, baselineConcertCount, "the S3 concert line count must be back to baseline");
  assert.ok(!remaining.some((concert) => concert.title === THROWAWAY_TITLE));
  console.log(`   S3 line removed: ${concertId} (${remaining.length} concert lines, baseline ${baselineConcertCount})`);

  // --- Verify Supabase is fully clean ---
  for (const table of ["rk_concerts", "rk_ticket_types", "rk_orders", "rk_tickets"]) {
    const { data } = await supabase.from(table).select("id,concert_id").eq("concert_id", concertId);
    assert.equal((data ?? []).length, 0, `${table} must have 0 rows for the throwaway concert`);
  }
  console.log("   Supabase check: 0 rows in rk_concerts / rk_ticket_types / rk_orders / rk_tickets for the throwaway id");

  // --- Stripe leftovers: deactivate this run's prices, del/archive products ---
  const rkPrices = [];
  for await (const price of stripe.prices.list({ limit: 100 })) {
    if (price.lookup_key?.startsWith("rk:")) rkPrices.push(price);
  }
  const priceIds = new Set();
  const productIds = new Set();
  for (const price of rkPrices) {
    const product = typeof price.product === "string" ? price.product : price.product?.id;
    const product_ = await stripe.products.retrieve(product);
    if (product_.name?.startsWith("Réz körút – Teszt")) {
      priceIds.add(price.id);
      productIds.add(product);
    }
  }
  const deactivated = [];
  for (const priceId of priceIds) {
    await stripe.prices.update(priceId, { active: false });
    deactivated.push(priceId);
  }
  console.log(`   prices deactivated (the Stripe API cannot delete a price): ${deactivated.join(", ") || "none"}`);

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
  console.log(`   products deleted: ${deleted.join(", ") || "none"}`);
  console.log(`   products archived (Stripe refuses products.del while prices exist): ${archived.join(", ") || "none"}`);

  // Verify: nothing throwaway is active or sellable.
  const activeThrowawayProducts = [];
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    if (product.name?.startsWith("Réz körút – Teszt")) activeThrowawayProducts.push(product);
  }
  assert.equal(activeThrowawayProducts.length, 0, "no throwaway product may remain active");
  const activeRkPrices = [];
  for await (const price of stripe.prices.list({ limit: 100 })) {
    if (price.lookup_key?.startsWith("rk:") && price.active) activeRkPrices.push(price);
  }
  assert.equal(activeRkPrices.length, 0, "no rk: price may remain active");
  console.log("   Stripe end state: every throwaway product archived/deleted, every rk: price inactive — nothing sellable");
});

console.log("\n==============================");
if (failures.length === 0) {
  console.log("ALL CHECKS PASSED");
  console.log("Stubbed (live key, per owner rule): Stripe session create, Stripe refund create, their amount/ids.");
  console.log("Real: every route, signature verification, Supabase writes/reads, SMTP ticket e-mail (to ORDER_CC).");
  process.exit(0);
} else {
  for (const name of failures) console.log(`FAILED: ${name}`);
  console.log("CHECKS FAILED");
  process.exit(1);
}
