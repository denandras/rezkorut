// Verification harness for card 11 (free / 0 Ft tickets).
// Run from the repo root against a dev server on port 3001:
//   npm run dev -- -p 3001
//   node scripts/card11-free-ticket-check.mjs
//
// STRIPE_SECRET_KEY is LIVE (sk_live_) on this account — the owner's standing
// rule (card 03 precedent): never create a real Checkout Session, never take
// a payment. The paid-session proof therefore drives the SAME shared lib the
// checkout route calls (createOrderAndCheckoutSession) with a STUBBED Stripe
// client that resolves the amount from the LIVE prices (inert read); the
// mixing/for-free rejections run through the REAL route and happen before
// any Stripe call. Free types never touch Stripe at all — the harness also
// asserts that from the live Stripe account (no product, no price under the
// free type's would-be lookup key).
//
// The buyer of every SUCCESSFUL request is ORDER_CC (the owner's mailbox) —
// never an invented address. The one request that uses a reserved
// @example.com address is REFUSED at capacity before any DB write, so no
// e-mail can ever be sent to it (asserted by the order count staying flat).
//
// Proofs (per the card):
//   setup) PUT a single 0 Ft type → row with stripe_price_id/stripe_lookup_key
//      null; price 100 Ft still rejected 400; publish with ONLY the free type
//      succeeds (free never blocks, no Stripe needed)
//   a) free request before publish → 409 not_on_sale
//   c) request 2 free tickets → 200, order paid / 0 Ft / stripe_session_id
//      null / stripe_payment_intent 'FREE', 2 tickets with valid codes, sold
//      incremented, ticket e-mail sent (real SMTP to ORDER_CC), emailed_at
//      stamped
//   d) 3rd request from the same e-mail → 409 with the per-e-mail cap message
//   e) request from the same e-mail for a second concert within 60 s → 429
//      „Túl sok kérés, próbálja később."
//   f) capacity exhausted → 409 „Erre a jegytípusra már nincs jegy." (and no
//      order row is created)
//   g) mixing free+paid in one checkout → 409; free-only cart via checkout →
//      400; the paid type through /free → 400
//   h) the paid flow is unaffected: shared-lib checkout on the paid type
//      still returns a Stripe session URL (stub) whose amount ties back to
//      the live DB price
//   i) TACITo cron run: 0 invoices selected for the free order (issued 0,
//      failed 0, free tickets keep tacito_invoice_id null)
//   j) /jegyek/koszonjuk?order=<token> shows the free order + codes; a
//      tampered token shows the plain fallback
//   k) /j/<code> works for a free ticket
//   l) the buy page: free type shows „Ingyenes" + „Jegy igénylése"; a
//      free-only concert has NO paid form at all
// Cleanup: tickets → orders → concert rows (ids printed), S3 lines, and the
// Stripe product/price of the throwaway PAID type (deactivated, product
// del/archived — the free type created none).

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
const CRON_SECRET = env("CRON_SECRET");
const ORDER_CC = env("ORDER_CC");
const stripeMode = STRIPE_KEY ? (STRIPE_KEY.startsWith("sk_live_") ? "live" : "test") : null;

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be in .env.local");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be in .env.local");
assert.ok(STRIPE_KEY, "STRIPE_SECRET_KEY must be in .env.local");
assert.ok(WEBHOOK_SECRET, "STRIPE_TICKET_WEBHOOK_SECRET must be in .env.local (order-token fallback key)");
assert.ok(CRON_SECRET, "CRON_SECRET must be in .env.local");
assert.ok(ORDER_CC, "ORDER_CC must be in .env.local");
assert.ok(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"), "SMTP_* must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`Stripe key mode: ${stripeMode}${stripeMode === "live" ? " (session writes STUBBED — no real Checkout Session, per the owner's standing rule)" : ""}`);
console.log(`Buyer e-mail for successful requests: ${ORDER_CC} (ORDER_CC — never an invented address)`);

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

const checkout = await import("../lib/ticket-checkout.ts");
const ticketCode = await import("../lib/ticket-code.ts");
const emailLib = await import("../lib/ticket-email.ts");
const admin = await import("../lib/concert-admin.ts");

// ---------------------------------------------------------------------------
// Stubbed Stripe client (the live key must never create a session)
// ---------------------------------------------------------------------------

function makeStubStripe(liveStripe) {
  const recorded = { sessions: [] };
  const stub = {
    recorded,
    checkout: {
      sessions: {
        async create(params) {
          // Resolve amount_total from the LIVE Stripe prices (inert read) —
          // this is what real Stripe would compute from these line items.
          const lines = [];
          for (const li of params.line_items ?? []) {
            const price = await liveStripe.prices.retrieve(li.price);
            lines.push({ price_id: li.price, quantity: li.quantity, unit_amount: price.unit_amount });
          }
          const amountTotal = lines.reduce((sum, line) => sum + line.unit_amount * line.quantity, 0);
          recorded.sessions.push({ id: `cs_stub_${recorded.sessions.length + 1}`, params, lines, amountTotal });
          return {
            id: `cs_stub_${recorded.sessions.length}`,
            object: "checkout.session",
            mode: "payment",
            payment_status: "unpaid",
            amount_total: amountTotal,
            currency: "huf",
            url: `https://checkout.stripe.com/c/pay_stub_${recorded.sessions.length}`,
          };
        },
      },
    },
  };
  return stub;
}

const stubStripe = makeStubStripe(stripe);

// ---------------------------------------------------------------------------
// HTTP + DB helpers
// ---------------------------------------------------------------------------

async function api(method, path, body, { withCookie = false, auth } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(withCookie ? { Cookie: COOKIE } : {}),
      ...(auth ? { Authorization: auth } : {}),
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

async function page(path) {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(120_000) });
  const html = await res.text();
  return { status: res.status, html };
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

// ---------------------------------------------------------------------------
// Section runner
// ---------------------------------------------------------------------------

const failures = [];
const THROWS = [];
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
// Throwaway concert data
// ---------------------------------------------------------------------------

const HU_MONTHS = ["január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december"];
const future = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
const futureIsoDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
const THROWAWAY_TITLE = "Teszt – ingyenes";
const THROWAWAY_TITLE2 = "Teszt – ingyenes 2";

let concert1 = null;
let concert2 = null;
let freeTypeId = null;
let paidTypeId = null;
let freeOrder = null; // { orderId, token, codes[] }
let baselineConcertCount = null;

// ---------------------------------------------------------------------------
// Pre-clean leftovers of crashed runs (tickets → orders → concerts; S3 lines)
// ---------------------------------------------------------------------------

async function deleteThrowawayConcerts() {
  const { data: leftovers, error } = await supabase
    .from("rk_concerts")
    .select("concert_id,title")
    .like("title", "Teszt – ingyenes%");
  if (error) throw new Error(`rk_concerts select failed: ${error.message}`);
  const removed = [];
  for (const row of leftovers ?? []) {
    const delTickets = await supabase.from("rk_tickets").delete().eq("concert_id", row.concert_id).select("id");
    if (delTickets.error) throw new Error(`rk_tickets delete failed: ${delTickets.error.message}`);
    const delOrders = await supabase.from("rk_orders").delete().eq("concert_id", row.concert_id).select("id");
    if (delOrders.error) throw new Error(`rk_orders delete failed: ${delOrders.error.message}`);
    const del = await supabase.from("rk_concerts").delete().eq("concert_id", row.concert_id).select("concert_id");
    if (del.error) throw new Error(`rk_concerts delete failed: ${del.error.message}`);
    removed.push(`${row.concert_id} (tickets ${delTickets.data?.length ?? 0}, orders ${delOrders.data?.length ?? 0})`);
  }
  for (const concert of await admin.listUpcomingConcerts()) {
    if (concert.title === THROWAWAY_TITLE || concert.title === THROWAWAY_TITLE2) {
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
  const removed = await deleteThrowawayConcerts();
  console.log(`   old leftovers removed: ${removed.length ? removed.join(", ") : "none"}`);
  // Baseline AFTER the leftover cleanup: a crashed earlier run may have left
  // its S3 lines behind, and those must not count into the baseline.
  baselineConcertCount = (await admin.listUpcomingConcerts()).length;
  console.log(`   baseline S3 concert lines: ${baselineConcertCount}`);
});

await section("(setup) free type: 0 Ft saves, no Stripe object, publish free-only", async () => {
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
  concert1 = res.json?.concert?.id;
  assert.ok(concert1, "the created concert must have an id");
  console.log(`   concert 1 id: ${concert1}`);

  // A sub-200 paid price stays rejected (only 0 is new).
  const bad = await api("PUT", `/api/intern/koncertek/${concert1}/ticket-types`, {
    types: [{ name: "Túl olcsó", kind: "standard", price_huf: 100, active: true, sort: 0 }],
  }, { withCookie: true });
  console.log(`   PUT price 100 → ${bad.status} ${JSON.stringify(bad.json)}`);
  assert.equal(bad.status, 400, "a 100 Ft paid type must still be rejected");

  // The free-only save.
  const put = await api("PUT", `/api/intern/koncertek/${concert1}/ticket-types`, {
    types: [{ name: "Ingyenes jegy", kind: "standard", price_huf: 0, capacity: 2, active: true, sort: 0 }],
  }, { withCookie: true });
  console.log(`   PUT free type (0 Ft, capacity 2): ${put.status}`);
  assert.equal(put.status, 200, `PUT free type failed: ${JSON.stringify(put.json)}`);
  freeTypeId = put.json?.types?.[0]?.id;
  assert.ok(freeTypeId, "the free type id must come back");
  assert.equal(put.json.types[0].price_huf, 0);
  assert.equal(put.json.types[0].stripe_price_id, null, "a free type must NOT carry a stripe_price_id");
  assert.equal(put.json.types[0].stripe_lookup_key, null, "a free type must NOT carry a stripe_lookup_key");

  const rows = await dbTypes(concert1);
  console.log(`   rk_ticket_types row (from Supabase): ${JSON.stringify(rows[0])}`);
  assert.equal(rows[0].stripe_price_id, null);
  assert.equal(rows[0].stripe_lookup_key, null);

  // Stripe proof of absence: no price holds the free type's would-be lookup
  // key, and no product is named after the free type (inert reads).
  const lookupKey = `rk:${concert1}:ingyenes-jegy-1`;
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 10 });
  console.log(`   Stripe prices under ${lookupKey}: ${prices.data.length} (want 0)`);
  assert.equal(prices.data.length, 0, "the free type must not have a Stripe price");
  let productHits = [];
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (product.name?.includes("Ingyenes jegy")) productHits.push(product.id);
  }
  console.log(`   Stripe products named after the free type: ${productHits.length} (want 0)`);
  assert.equal(productHits.length, 0, "the free type must not have a Stripe product");

  // Publish with ONLY the free type — must succeed (a free type never blocks).
  const publish = await api("POST", `/api/intern/koncertek/${concert1}/publish`, {}, { withCookie: true });
  console.log(`   publish free-only → ${publish.status} ${JSON.stringify(publish.json?.concert ? { status: publish.json.concert.status } : publish.json)}`);
  assert.equal(publish.status, 200, `publishing a free-only concert failed: ${JSON.stringify(publish.json)}`);
  assert.equal(publish.json?.concert?.status, "on_sale");

  // Now add the PAID type too (its Stripe price is created — inert object,
  // cleaned up at the end). It must be in place BEFORE the free requests:
  // with only the free type at capacity 2, a 2-ticket fulfilment would flip
  // the concert to sold_out (the shared fulfilment rule), while the paid
  // type keeps the concert on_sale. The free row must stay Stripe-free.
  const putPaid = await api("PUT", `/api/intern/koncertek/${concert1}/ticket-types`, {
    types: [
      { id: freeTypeId, name: "Ingyenes jegy", kind: "standard", price_huf: 0, capacity: 2, active: true, sort: 0 },
      { name: "Teljes árú jegy", kind: "standard", price_huf: 4500, capacity: 10, active: true, sort: 1 },
    ],
  }, { withCookie: true });
  assert.equal(putPaid.status, 200, `adding the paid type failed: ${JSON.stringify(putPaid.json)}`);
  paidTypeId = putPaid.json?.types?.find((type) => type.price_huf > 0)?.id;
  assert.ok(paidTypeId, "the paid type id must come back");
  const freeRow = putPaid.json.types.find((type) => type.id === freeTypeId);
  console.log(`   after adding the paid type, the free row: stripe_price_id ${freeRow.stripe_price_id}, stripe_lookup_key ${freeRow.stripe_lookup_key}`);
  assert.equal(freeRow.stripe_price_id, null, "the free row must stay Stripe-free");
  assert.ok(putPaid.json.types.find((type) => type.price_huf > 0).stripe_price_id, "the paid type must have its price");
});

await section("(a) free request before publish is refused — 409 not_on_sale", async () => {
  // Concert 2 is still draft here — create it now for its later sections.
  const res = await api("POST", "/api/intern/koncertek", {
    date: futureIsoDate,
    time: "19:00",
    location: "Teszt város",
    venue: "Teszt terem",
    title: THROWAWAY_TITLE2,
    program: ["Teszt szerző: Teszt mű"],
  }, { withCookie: true });
  assert.equal(res.status, 200, `POST concert 2 failed: ${JSON.stringify(res.json)}`);
  concert2 = res.json?.concert?.id;
  assert.ok(concert2, "concert 2 must have an id");
  console.log(`   concert 2 id: ${concert2} (draft)`);

  const put2 = await api("PUT", `/api/intern/koncertek/${concert2}/ticket-types`, {
    types: [{ name: "Ingyenes jegy", kind: "standard", price_huf: 0, capacity: 4, active: true, sort: 0 }],
  }, { withCookie: true });
  assert.equal(put2.status, 200, `PUT concert 2 free type failed: ${JSON.stringify(put2.json)}`);
  assert.equal(put2.json?.types?.[0]?.stripe_price_id, null);

  const req = await api("POST", "/api/tickets/free", {
    concert_id: concert2,
    ticket_type_id: put2.json.types[0].id,
    quantity: 1,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  console.log(`   free request on a draft concert → ${req.status} ${JSON.stringify(req.json)}`);
  assert.equal(req.status, 409);
  assert.equal(req.json?.error, "not_on_sale");
  assert.equal((await dbOrderIds(concert2)).length, 0, "no order row may be created by the refusal");
});

await section("(c) request 2 free tickets → 200, paid/0 Ft order, codes, e-mail", async () => {
  const res = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: freeTypeId,
    quantity: 2,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  console.log(`   status: ${res.status}`);
  console.log(`   body: ${JSON.stringify({ ...res.json, token: res.json?.token ? `${res.json.token.slice(0, 8)}…` : null })}`);
  assert.equal(res.status, 200, `the free request failed: ${JSON.stringify(res.json)}`);
  assert.equal(res.json?.status, "paid");
  assert.equal(res.json?.amount_huf, 0);
  assert.equal(res.json?.tickets?.length, 2, "2 tickets must come back");
  assert.ok(res.json?.token, "the response must carry the signed confirmation token");
  assert.equal(res.json?.email_sent, true, "the ticket e-mail must have been sent");
  freeOrder = { orderId: res.json.order_id, token: res.json.token, codes: res.json.tickets.map((t) => t.code) };

  const order = await dbOrder(freeOrder.orderId);
  console.log(`   rk_orders row: status ${order.status} | amount_huf ${order.amount_huf} | session ${order.stripe_session_id} | payment_intent ${order.stripe_payment_intent} | paid_at ${order.paid_at}`);
  assert.equal(order.status, "paid");
  assert.equal(order.amount_huf, 0);
  assert.equal(order.stripe_session_id, null, "a free order has no Stripe session");
  assert.equal(order.stripe_payment_intent, "FREE", "the FREE marker must be in stripe_payment_intent");
  assert.ok(order.paid_at, "paid_at must be stamped");
  assert.equal(order.buyer_email, ORDER_CC);

  const tickets = await dbTickets(freeOrder.orderId);
  assert.equal(tickets.length, 2, "exactly 2 ticket rows");
  const codes = new Set();
  for (const ticket of tickets) {
    assert.match(ticket.code, /^[0-9A-Z]{10}$/, `code ${ticket.code} must be 10 Crockford base32 chars`);
    assert.ok(ticketCode.isValidCode(ticket.code), "the code must validate through lib/ticket-code");
    assert.equal(ticket.price_huf, 0);
    assert.equal(ticket.status, "valid");
    assert.ok(ticket.emailed_at, "emailed_at must be stamped (the e-mail really went out)");
    codes.add(ticket.code);
  }
  assert.equal(codes.size, 2, "both codes must be unique");
  console.log(`   tickets: ${tickets.map((t) => t.code).join(", ")} (all valid, emailed_at stamped)`);

  const types = await dbTypes(concert1);
  const freeType = types.find((type) => type.id === freeTypeId);
  console.log(`   sold after fulfilment: ${freeType.sold}/${freeType.capacity}`);
  assert.equal(freeType.sold, 2, "sold must be incremented by the shared fulfilment path");

  const concert = await dbConcert(concert1);
  console.log(`   concert status: ${concert.status} (the paid type keeps it on_sale though the free type is at capacity)`);
  assert.equal(concert.status, "on_sale");

  // The e-mail body is built by the same pure builders the fulfilment used —
  // free wording, no számla sentence.
  const html = emailLib.buildTicketEmailHtml({
    orderId: freeOrder.orderId,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    concert: { title: concert.title, event_date: concert.event_date, event_time: concert.event_time, venue: concert.venue, location: concert.location },
    tickets: tickets.map((t) => ({ code: t.code, ticket_type_name: t.ticket_type_name, price_huf: t.price_huf })),
  });
  const text = emailLib.buildTicketEmailText({
    orderId: freeOrder.orderId,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    concert: { title: concert.title, event_date: concert.event_date, event_time: concert.event_time, venue: concert.venue, location: concert.location },
    tickets: tickets.map((t) => ({ code: t.code, ticket_type_name: t.ticket_type_name, price_huf: t.price_huf })),
  });
  assert.ok(html.includes("Köszönjük az igénylést!"), "the free e-mail headline must say igénylés");
  assert.ok(text.includes("Köszönjük az igénylést!"));
  assert.ok(html.includes("számla nem készül róla"), "the free e-mail must say no számla is issued");
  assert.ok(!html.includes("a számlát a számlázási rendszerünktől"), "the paid-only számla sentence must be gone");
  assert.ok(html.includes("Ingyenes"), "the total must read Ingyenes");
  for (const code of freeOrder.codes) {
    assert.ok(html.includes(code) && text.includes(code), "the e-mail must carry the codes");
    assert.ok(html.includes(emailLib.ticketUrl(code)), "the e-mail must carry the /j/<code> link");
  }
  const emoji = /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u;
  assert.ok(!emoji.test(html) && !emoji.test(text), "no emoji in the free e-mail");
});

await section("(d) 3rd request from the same e-mail → 409 per-e-mail cap", async () => {
  const before = await dbOrderIds(concert1);
  const res = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: freeTypeId,
    quantity: 1,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  console.log(`   status: ${res.status} ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 409, "the third free ticket must be refused");
  assert.equal(res.json?.message, "Erre a koncertre ezzel az e-mail-címmel legfeljebb 2 ingyenes jegy kérhető.");
  assert.equal((await dbOrderIds(concert1)).length, before.length, "no order row may be created");
});

await section("(e) 60 s guard → 429 „Túl sok kérés, próbálja később.”", async () => {
  // Concert 2 goes on sale (free-only publish already proven on concert 1).
  const publish = await api("POST", `/api/intern/koncertek/${concert2}/publish`, {}, { withCookie: true });
  assert.equal(publish.status, 200, `publishing concert 2 failed: ${JSON.stringify(publish.json)}`);
  console.log(`   concert 2 published (${publish.json?.concert?.status})`);

  const type2 = (await dbTypes(concert2))[0];
  // Same e-mail, different concert, within 60 s of the order in (c): the
  // per-concert cap passes, the per-e-mail rate guard must fire.
  const res = await api("POST", "/api/tickets/free", {
    concert_id: concert2,
    ticket_type_id: type2.id,
    quantity: 1,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  console.log(`   status: ${res.status} ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 429, "the request within 60 s of the e-mail's latest order must be 429");
  assert.equal(res.json?.message, "Túl sok kérés, próbálja később.");
  assert.equal((await dbOrderIds(concert2)).length, 0, "no order row may be created");
});

await section("(f) capacity exhausted → 409 „Erre a jegytípusra már nincs jegy.”", async () => {
  const before = await dbOrderIds(concert1);
  // The free type of concert 1 is at capacity (sold 2/2). A fresh address is
  // used — the request is refused BEFORE any write, so no e-mail can ever be
  // sent to it (reserved example.com, nothing deliverable).
  const res = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: freeTypeId,
    quantity: 1,
    buyer: { name: "Ellenőrző Név", email: "kapacitas-ellenorzes@example.com" },
    accept_terms: true,
  });
  console.log(`   status: ${res.status} ${JSON.stringify(res.json)}`);
  assert.equal(res.status, 409, "the exhausted free type must be refused");
  assert.equal(res.json?.message, "Erre a jegytípusra már nincs jegy.");
  assert.equal((await dbOrderIds(concert1)).length, before.length, "no order row may be created");
});

await section("(g) mixing forbidden + paid type through /free rejected", async () => {
  const buyer = {
    name: "Teszt Vásárló",
    email: ORDER_CC,
    phone: "",
    address: { postal_code: "1234", city: "Tesztváros", street: "Teszt utca 1." },
  };

  // Free + paid in one checkout → 409 with the card's exact message.
  const mixed = await api("POST", "/api/tickets/checkout", {
    concert_id: concert1,
    items: [
      { ticket_type_id: freeTypeId, quantity: 1 },
      { ticket_type_id: paidTypeId, quantity: 1 },
    ],
    buyer,
    accept_terms: true,
  });
  console.log(`   mixed cart → ${mixed.status} ${JSON.stringify(mixed.json)}`);
  assert.equal(mixed.status, 409, "mixing free and paid types must be 409");
  assert.equal(mixed.json?.error, "free_paid_mixed");
  assert.equal(mixed.json?.message, "Ingyenes és fizetős jegy nem kérhető egy vásárlásban.");

  // A free-only cart through the paid checkout → 400 (not a purchase).
  const freeOnly = await api("POST", "/api/tickets/checkout", {
    concert_id: concert1,
    items: [{ ticket_type_id: freeTypeId, quantity: 2 }],
    buyer,
    accept_terms: true,
  });
  console.log(`   free-only cart → ${freeOnly.status} ${JSON.stringify(freeOnly.json)}`);
  assert.equal(freeOnly.status, 400);
  assert.equal(freeOnly.json?.error, "free_via_checkout");

  // The PAID type through the free endpoint → 400.
  const paidViaFree = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: paidTypeId,
    quantity: 1,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  console.log(`   paid type via /free → ${paidViaFree.status} ${JSON.stringify(paidViaFree.json)}`);
  assert.equal(paidViaFree.status, 400);
  assert.equal(paidViaFree.json?.error, "not_free_type");

  // Shape negatives: quantity 3 → 400, missing terms → 400.
  const tooMany = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: freeTypeId,
    quantity: 3,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: true,
  });
  assert.equal(tooMany.status, 400, "quantity 3 must be rejected (1–2 allowed)");
  const noTerms = await api("POST", "/api/tickets/free", {
    concert_id: concert1,
    ticket_type_id: freeTypeId,
    quantity: 1,
    buyer: { name: "Teszt Vásárló", email: ORDER_CC },
    accept_terms: false,
  });
  assert.equal(noTerms.status, 400, "missing accept_terms must be rejected");
  assert.equal(noTerms.json?.error, "terms_required");
  console.log(`   quantity 3 → ${tooMany.status}; accept_terms false → ${noTerms.status} (terms_required)`);
});

await section("(h) paid flow unaffected: shared-lib checkout still returns a session URL", async () => {
  // Same proof style as card 03: the live key must not create a REAL session,
  // so the shared function runs with a stubbed client; the amount is resolved
  // from the LIVE Stripe price of the paid type (inert read).
  const parsed = checkout.parseCheckoutRequest({
    concert_id: concert1,
    items: [{ ticket_type_id: paidTypeId, quantity: 2 }],
    buyer: {
      name: "Teszt Vásárló",
      email: ORDER_CC,
      phone: "",
      address: { postal_code: "1234", city: "Tesztváros", street: "Teszt utca 1." },
    },
    accept_terms: true,
  });
  assert.ok(parsed.request, `parseCheckoutRequest rejected a valid payload: ${parsed.error}`);
  const result = await checkout.createOrderAndCheckoutSession(stubStripe, parsed.request, "https://rezkorut.hu");

  const session = stubStripe.recorded.sessions[0];
  console.log(`   session url: ${result.url} (stub — the live key must not create a real Checkout Session)`);
  console.log(`   session line items: ${session.lines.length}; amount_total (from the LIVE price): ${session.amountTotal / 100} Ft (want 9000)`);
  assert.ok(result.url.startsWith("https://checkout.stripe.com/"), "the shared checkout path must still return a Stripe URL");
  assert.equal(session.amountTotal / 100, 9000, "2 × 4500 Ft must tie back to the DB price");
  assert.equal(session.lines.length, 1);
  assert.equal(session.lines[0].unit_amount, 4500 * 100);

  const order = await dbOrder(result.orderId);
  console.log(`   rk_orders row: status ${order.status} | amount_huf ${order.amount_huf} | session ${order.stripe_session_id}`);
  assert.equal(order.status, "pending");
  assert.equal(order.amount_huf, 9000);
  assert.equal(order.buyer_company, null);
  assert.equal(order.buyer_tax_number, null);
});

await section("(i) TACITo cron: 0 invoices selected for the free order", async () => {
  const before = await api("GET", "/api/intern/tacito/status", undefined, { withCookie: true });
  assert.equal(before.status, 200, "the status tile must answer");
  const pendingBefore = before.json?.counts?.pending_tickets ?? null;
  console.log(`   status tile pending_tickets before the run: ${pendingBefore}`);

  if (pendingBefore === null || pendingBefore > 0) {
    // There are real pending tickets (not ours) — a cron run would invoice
    // THEM. Prove the exclusion via the DB instead of running the cron.
    THROWS.push(`cron run skipped: pending_tickets was ${pendingBefore} before the run — free-order exclusion proven via the status tile + DB only`);
    const tickets = await dbTickets(freeOrder.orderId);
    for (const ticket of tickets) {
      assert.equal(ticket.tacito_invoice_id, null, "the free ticket must carry no invoice");
    }
    console.log(`   free tickets still carry tacito_invoice_id: null (× ${tickets.length})`);
    const afterTile = await api("GET", "/api/intern/tacito/status", undefined, { withCookie: true });
    console.log(`   status tile pending_tickets now: ${afterTile.json?.counts?.pending_tickets} (free order must not count as pending)`);
    assert.equal(afterTile.json?.counts?.pending_tickets, pendingBefore, "the free order must not change the pending count");
    return;
  }

  const res = await fetch(`${BASE_URL}/api/cron/tacito-invoices`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(300_000),
  });
  const cron = await res.json().catch(() => null);
  console.log(`   cron status: ${res.status}`);
  console.log(`   cron result: ${JSON.stringify(cron)}`);
  assert.equal(res.status, 200);
  assert.equal(cron?.ok, true);
  assert.equal(cron?.issued, 0, "0 invoices must be selected — the free order is excluded");
  assert.equal(cron?.failed, 0);
  assert.equal(cron?.stornoed, 0);
  assert.equal(cron?.details?.length, 0, "no ticket of the free order may appear in the details");
  assert.equal(cron?.pending, 0);

  const tickets = await dbTickets(freeOrder.orderId);
  for (const ticket of tickets) {
    assert.equal(ticket.tacito_invoice_id, null, "the free ticket must never be queued for TACITo");
    assert.equal(ticket.tacito_error, null);
  }
  console.log(`   free tickets after the cron run: tacito_invoice_id null × ${tickets.length} — no számla for 0 Ft`);

  const afterTile = await api("GET", "/api/intern/tacito/status", undefined, { withCookie: true });
  console.log(`   status tile pending_tickets now: ${afterTile.json?.counts?.pending_tickets} (free tickets never count as pending)`);
  assert.equal(afterTile.json?.counts?.pending_tickets, 0);
});

await section("(j) /jegyek/koszonjuk accepts the free order via the signed token", async () => {
  const good = await page(`/jegyek/koszonjuk?order=${encodeURIComponent(freeOrder.token)}`);
  console.log(`   valid token → ${good.status}, ${good.html.length} bytes`);
  assert.equal(good.status, 200);
  assert.ok(good.html.includes("Köszönjük az igénylést!"), "the headline must be the free wording");
  // React SSR interleaves interpolation markers, so the buyer name is checked
  // as its own contiguous text node.
  assert.ok(good.html.includes("Teszt Vásárló"), "the buyer name must show");
  for (const code of freeOrder.codes) {
    assert.ok(good.html.includes(code), `the code ${code} must show`);
  }
  assert.ok(good.html.includes("Ingyenes"), "the free price label must show");
  assert.ok(good.html.includes("számla nem készül"), "the free confirmation must say no számla");
  assert.ok(!good.html.includes("Fizetendő összeg: 0"), "no paid-style total line for a free order");

  const tampered = `${freeOrder.token.slice(0, -4)}dead`;
  const bad = await page(`/jegyek/koszonjuk?order=${encodeURIComponent(tampered)}`);
  console.log(`   tampered token → ${bad.status}`);
  assert.equal(bad.status, 200);
  assert.ok(bad.html.includes("Köszönjük!"), "the plain fallback must render");
  assert.ok(!bad.html.includes(freeOrder.codes[0]), "no ticket code may leak on a bad token");
});

await section("(k) /j/<code> works for a free ticket", async () => {
  const res = await page(`/j/${freeOrder.codes[0]}`);
  console.log(`   /j/<code> → ${res.status}`);
  assert.equal(res.status, 200);
  assert.ok(res.html.includes(freeOrder.codes[0]), "the code must show");
  assert.ok(res.html.includes("Érvényes"), "a fresh free ticket must read érvényes");
  assert.ok(res.html.includes("Ingyenes jegy"), "the type name must show");
});

await section("(l) buy page: „Ingyenes” + „Jegy igénylése”, free-only has no paid form", async () => {
  // Mixed concert (free type 2/2 at this point in the run, so its row shows
  // the „Elfogyott” pill like a sold-out paid type would): the paid flow must
  // be fully present, the free row must show Ingyenes.
  const mixed = await page(`/jegyek/${concert1}`);
  console.log(`   mixed concert page → ${mixed.status}`);
  assert.equal(mixed.status, 200);
  assert.ok(mixed.html.includes("Ingyenes"), "the free type must show Ingyenes");
  assert.ok(mixed.html.includes("Elfogyott"), "the sold-out free type must show Elfogyott");
  assert.ok(mixed.html.includes("Tovább a fizetéshez"), "the paid flow must stay");
  // React SSR splits `{formatHuf(...)} Ft` with a comment marker, so the
  // formatted number itself is the contiguous text node.
  assert.ok(mixed.html.includes("4\u00a0500"), "the paid price must stay");

  // Free-only concert (tickets remaining): the request button, no paid form.
  const freeOnly = await page(`/jegyek/${concert2}`);
  console.log(`   free-only concert page → ${freeOnly.status}`);
  assert.equal(freeOnly.status, 200);
  assert.ok(freeOnly.html.includes("Jegy igénylése"), "the free-only page must show the request button");
  assert.ok(freeOnly.html.includes("Ingyenes"), "the free-only page must show Ingyenes");
  assert.ok(!freeOnly.html.includes("Tovább a fizetéshez"), "no paid submit on a free-only concert");
  assert.ok(!freeOnly.html.includes("Irányítószám"), "no address fields on a free-only concert");
  assert.ok(!freeOnly.html.includes("Stripe"), "no Stripe mention on a free-only concert");
  assert.ok(!freeOnly.html.includes("Elfogyott"), "the free-only type still has tickets");
});

await section("(cleanup) delete every throwaway row (ids printed), S3 lines, Stripe leftovers", async () => {
  for (const [label, concertId] of [["concert 1", concert1], ["concert 2", concert2]]) {
    if (!concertId) continue;
    const delTickets = await supabase.from("rk_tickets").delete().eq("concert_id", concertId).select("id,code");
    assert.ok(!delTickets.error, `rk_tickets delete failed: ${delTickets.error?.message}`);
    const delOrders = await supabase.from("rk_orders").delete().eq("concert_id", concertId).select("id");
    assert.ok(!delOrders.error, `rk_orders delete failed: ${delOrders.error?.message}`);
    const typesBefore = await dbTypes(concertId);
    const delConcert = await supabase.from("rk_concerts").delete().eq("concert_id", concertId).select("concert_id");
    assert.ok(!delConcert.error, `rk_concerts delete failed: ${delConcert.error?.message}`);
    console.log(`   ${label} ${concertId}:`);
    console.log(`     rk_tickets deleted (${delTickets.data?.length ?? 0}): ${(delTickets.data ?? []).map((row) => `${row.id} (${row.code})`).join(", ")}`);
    console.log(`     rk_orders deleted (${delOrders.data?.length ?? 0}): ${(delOrders.data ?? []).map((row) => row.id).join(", ")}`);
    console.log(`     rk_ticket_types cascaded (${typesBefore.length}): ${typesBefore.map((type) => `${type.id} (${type.name})`).join(", ")}`);
    console.log(`     rk_concerts deleted: ${(delConcert.data ?? []).map((row) => row.concert_id).join(", ")}`);

    await admin.deleteConcert(concertId);
    for (const table of ["rk_concerts", "rk_ticket_types", "rk_orders", "rk_tickets"]) {
      const { data } = await supabase.from(table).select("id,concert_id").eq("concert_id", concertId);
      assert.equal((data ?? []).length, 0, `${table} must have 0 rows for ${concertId}`);
    }
    console.log(`     S3 line removed; verify: 0 rows in rk_concerts / rk_ticket_types / rk_orders / rk_tickets`);
  }
  const remaining = await admin.listUpcomingConcerts();
  assert.equal(remaining.length, baselineConcertCount, `the S3 concert line count must be back to baseline (${baselineConcertCount})`);
  assert.ok(!remaining.some((concert) => concert.title === THROWAWAY_TITLE || concert.title === THROWAWAY_TITLE2));
  console.log(`   S3 file: ${remaining.length} concert lines (baseline ${baselineConcertCount})`);

  // Stripe: only the PAID type created objects. Deactivate its price, then
  // del/archive its product (the free type created none — verified in setup).
  const priceIds = new Set();
  const productIds = new Set();
  for await (const price of stripe.prices.list({ limit: 100 })) {
    if (price.lookup_key?.startsWith(`rk:${concert1}:`) || price.lookup_key?.startsWith(`rk:${concert2}:`)) {
      const product = typeof price.product === "string" ? price.product : price.product?.id;
      priceIds.add(price.id);
      productIds.add(product);
    }
  }
  const deactivated = [];
  for (const priceId of priceIds) {
    await stripe.prices.update(priceId, { active: false });
    deactivated.push(priceId);
  }
  console.log(`   Stripe prices deactivated (${deactivated.length} — the free type never had one): ${deactivated.join(", ") || "none"}`);
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
  console.log(`   Stripe products deleted: ${deleted.join(", ") || "none"}`);
  if (archived.length) console.log(`   Stripe products archived (Stripe refuses products.del while prices exist): ${archived.join(", ")}`);

  // End state: nothing throwaway is active or sellable.
  let activeThrowaway = [];
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    if (product.name?.startsWith("Réz körút – Teszt – ingyenes")) activeThrowaway.push(product.id);
  }
  assert.equal(activeThrowaway.length, 0, "no throwaway product may remain active");
  const throwawayPrices = [];
  const activeThrowawayPrices = [];
  for await (const price of stripe.prices.list({ limit: 100 })) {
    if (price.lookup_key?.startsWith(`rk:${concert1}:`) || price.lookup_key?.startsWith(`rk:${concert2}:`)) {
      throwawayPrices.push(price.id);
      if (price.active) activeThrowawayPrices.push(price.id);
    }
  }
  assert.equal(activeThrowawayPrices.length, 0, "no throwaway rk: price may remain active");
  console.log(`   Stripe end state: throwaway products deleted/archived, ${throwawayPrices.length} throwaway price(s) all inactive — nothing sellable`);
});

console.log("\n==============================");
if (failures.length === 0 && THROWS.length === 0) {
  console.log("ALL CHECKS PASSED");
  console.log("Stubbed (live key, per the owner's standing rule): the paid session create — no real Checkout Session.");
  console.log("Real: every route, Supabase writes/reads, the free fulfilment, SMTP ticket e-mail (to ORDER_CC), the TACITo cron run.");
  process.exit(0);
} else {
  for (const name of failures) console.log(`FAILED: ${name}`);
  for (const note of THROWS) console.log(`NOTE: ${note}`);
  console.log(failures.length ? "CHECKS FAILED" : "CHECKS PASSED WITH EXCEPTIONS");
  process.exit(failures.length ? 1 : 2);
}
