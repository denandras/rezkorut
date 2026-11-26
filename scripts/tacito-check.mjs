// Verification harness for card 04 (TACITo invoicing + cron jobs).
// Run from the repo root:
//   npm run dev -- -p 3001        # separate terminal (route checks need it)
//   node scripts/tacito-check.mjs
//
// DRAFT-FIRST against the LIVE TACITo API (the key is read+write, verified
// today): every write here creates a DRAFT that is deleted in the same run.
// The harness NEVER issues, never sends, never stornos, never creates a
// product — the only TACITo writes are `POST /invoices` (draft) and
// `DELETE /invoices/<id>`. The buyer e-mail is ORDER_CC (never an invented
// address); the API key is never printed.
//
// Proofs (per the card):
//   a) buildTicketInvoice for a fake order/ticket — payload printed + asserted
//      (private AND company buyer variants; the company branch is dead code
//      under the owner's private-buyers-only decision, exercised here anyway).
//   b) create it as a DRAFT → state DRAFT, invoice_number null, nav_outcome
//      NOT_CONFIGURED/NOT_REPORTABLE, AAM markers (exemption_reason_code AAM,
//      legal_basis_code HU_VAT_ACT_187, "Áfa tv. 187. § szerinti alanyi
//      adómentes" text present), series_id = the hard-coded ELOADO id.
//   e) crash-recovery: replay `createDraft` with the SAME reference → the
//      SAME draft id (create-step replay); a DIFFERENT reference → a new
//      draft (the reference is the dedupe). createAndIssue's issue-step
//      replay cannot be proven without issuing a real invoice — see the
//      final report line.
//   c) delete both drafts, confirm they are gone (GET → 404).
//   d) GET /products before/after: TACITo autosaves the line description as
//      a product (product_autosave_enabled) — print the catalog, prove no
//      OTHER product (no per-concert product) appeared.
//   f) bonus (real routes on the dev server): health endpoint + all three
//      cron routes — 401 paths, and the authorized empty runs (0 pending
//      tickets → zero TACITo writes), events cursor persisted.
//   0) final proof: GET /invoices contains no ISSUED invoice — 0 real
//      (issued) invoices were created by this run.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const BASE_URL = process.env.TACITO_CHECK_BASE_URL || "http://localhost:3001";
const COOKIE = "rezkorut-intern-auth=1";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = env("CRON_SECRET");
const ORDER_CC = env("ORDER_CC");

assert.ok(env("TACITO_API_KEY"), "TACITO_API_KEY must be in .env.local");
assert.ok(SUPABASE_URL && SERVICE_KEY, "Supabase env must be in .env.local");
assert.ok(CRON_SECRET, "CRON_SECRET must be in .env.local (dev value is fine)");
assert.ok(ORDER_CC, "ORDER_CC must be in .env.local");

console.log(`Base URL: ${BASE_URL}`);
console.log(`Supabase: ${SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0]}`);
console.log(`TACITO key: present (${env("TACITO_API_KEY").length} chars, not printed)`);
console.log(`CRON_SECRET: present (${CRON_SECRET.length} chars, not printed)`);
console.log(`Draft buyer e-mail: ${ORDER_CC} (ORDER_CC — no invented address)`);

// ---------------------------------------------------------------------------
// "@" alias hook + server lib imports (same style as the card 01–03 harnesses)
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

const tacitoLib = await import("../lib/tacito.ts");
const { buildTicketInvoice, TacitoClient, TACITO_SERIES_ID, ticketReference } = tacitoLib;
const { makeCode } = await import("../lib/ticket-code.ts");

const client = new TacitoClient({ apiKey: env("TACITO_API_KEY") });

const todayBudapest = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());

// ---------------------------------------------------------------------------
// Fake order / ticket / concert (clearly harness artifacts; drafts are deleted)
// ---------------------------------------------------------------------------

const ORDER_ID = randomUUID();
const TICKET_ID = randomUUID();
const TICKET_ID_2 = randomUUID();
const PRICE_HUF = 3500;

const fakeOrder = {
  id: ORDER_ID,
  concert_id: "rk-harness-concert",
  buyer_name: "TACITo Ellenőrzés",
  buyer_email: ORDER_CC,
  buyer_phone: "+36301234567",
  buyer_company: null,
  buyer_tax_number: null,
  address_country: "HU",
  address_postal: "1133",
  address_city: "Budapest",
  address_street: "Garam utca 23.",
  amount_huf: PRICE_HUF,
  currency: "HUF",
  stripe_session_id: null,
  stripe_payment_intent: null,
  status: "paid",
  paid_at: new Date().toISOString(),
  refunded_at: null,
  tacito_error: null,
  created_at: new Date().toISOString(),
};

const fakeTicket = {
  id: TICKET_ID,
  order_id: ORDER_ID,
  concert_id: "rk-harness-concert",
  ticket_type_id: null,
  ticket_type_name: "Standard jegy",
  price_huf: PRICE_HUF,
  code: makeCode(),
  status: "valid",
  used_at: null,
  tacito_invoice_id: null,
  tacito_invoice_number: null,
  tacito_nav_outcome: null,
  tacito_error: null,
  tacito_storno_number: null,
  emailed_at: null,
  created_at: new Date().toISOString(),
};

const fakeConcert = {
  concert_id: "rk-harness-concert",
  title: "TACITo ellenőrző koncert (harness draft)",
  event_date: "2026-12-05",
  event_time: "19:00",
  location: "Budapest",
  venue: "Ellenőrzés Terem",
  status: "on_sale",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const section = (name) => console.log(`\n--- ${name} ---`);
let realIssuedInvoices = 0;

// ---------------------------------------------------------------------------
// Snapshot before any write: products catalog + issued-invoice list
// ---------------------------------------------------------------------------

section("pre — TACITo state before any write");
const productsBefore = await client.products();
const productNamesBefore = productsBefore.items.map((item) => item.name).sort();
console.log(`products before: ${JSON.stringify(productNamesBefore)}`);
const listBefore = await client.listInvoices();
const issuedBefore = (Array.isArray(listBefore) ? listBefore : []).filter(
  (item) => item.state === "ISSUED",
);
console.log(`invoice list before: ${Array.isArray(listBefore) ? listBefore.length : 0} item(s), of which ISSUED: ${issuedBefore.length}`);
realIssuedInvoices = issuedBefore.length;

// ---------------------------------------------------------------------------
// (a) payload builder
// ---------------------------------------------------------------------------

section("a) buildTicketInvoice — private buyer payload (printed)");
const built = buildTicketInvoice(fakeOrder, fakeTicket, fakeConcert);
console.log(JSON.stringify(built, null, 1));

assert.equal(built.reference, `rezkorut:ticket-${TICKET_ID}`);
assert.equal(built.payload.series_id, TACITO_SERIES_ID);
assert.equal(built.payload.buyer.is_taxable_person, false);
assert.equal("tax_number" in built.payload.buyer, false);
assert.equal(built.payload.buyer.name, "TACITo Ellenőrzés");
assert.equal(built.payload.buyer.email, ORDER_CC);
assert.equal(built.payload.buyer.country_code, "HU");
assert.equal(built.payload.buyer.postal_code, "1133");
assert.equal(built.payload.buyer.city, "Budapest");
assert.equal(built.payload.buyer.address, "Garam utca 23.");
assert.equal(built.payload.lines.length, 1);
assert.deepEqual(built.payload.lines, [
  {
    description: "Előadó-művészeti tevékenység",
    quantity: "1",
    unit: "alkalom",
    unit_price_gross: "3500",
    vat_rate: "AAM",
  },
]);
assert.equal(built.payload.payment_method, "CARD");
assert.equal(built.payload.currency, "HUF");
assert.equal(built.payload.language, "hu");
assert.equal(built.payload.issue_date, todayBudapest);
assert.equal(built.payload.performance_date, "2026-12-05");
assert.equal(built.payload.due_date, built.payload.issue_date);

const noteLines = built.payload.invoice_note.split("\n");
assert.equal(noteLines.length, 6);
assert.ok(noteLines[0].startsWith("Koncert: "));
assert.ok(noteLines[1].startsWith("Időpont: 2026. 12. 05., 19:00"));
assert.ok(noteLines[2].startsWith("Helyszín: "));
assert.ok(noteLines[3] === `Jegytípus: ${fakeTicket.ticket_type_name}`);
assert.ok(noteLines[4] === `Jegy: ${fakeTicket.code}`);
assert.ok(noteLines[5] === `Rendelés: ${ORDER_ID.slice(-8)}`);
console.log("payload assertions: PASS (reference, ELOADO series, private buyer, AAM line, dates, 6-fact note)");

section("a2) buildTicketInvoice — company buyer variant (dead code under the owner decision)");
const companyOrder = { ...fakeOrder, buyer_company: "Teszt Kft.", buyer_tax_number: "12345678-2-41" };
const companyBuilt = buildTicketInvoice(companyOrder, fakeTicket, fakeConcert);
assert.equal(companyBuilt.payload.buyer.is_taxable_person, true);
assert.equal(companyBuilt.payload.buyer.tax_number, "12345678-2-41");
console.log(
  `company branch builds tax_number + is_taxable_person:true (purchase form never collects one — private buyers only)`,
);

// ---------------------------------------------------------------------------
// (b) draft create
// ---------------------------------------------------------------------------

section("b) create as DRAFT (POST /invoices, no issuing)");
const draft = await client.createDraft(built.reference, built.payload);
console.log(`draft id: ${draft.id}`);
console.log(`state: ${draft.state}`);
console.log(`invoice_number: ${draft.invoice_number}`);
console.log(`nav_outcome: ${draft.nav_outcome}`);
console.log(`series_id: ${draft.series_id}`);
console.log(`gross_total: ${draft.gross_total}`);
console.log(`exemption_reason_code: ${draft.exemption_reason_code}`);
console.log(`legal_basis_code: ${draft.legal_basis_code}`);
console.log(`invoice_note stored as sent: ${draft.invoice_note === built.payload.invoice_note}`);
console.log(`mandatory_tax_texts: ${JSON.stringify(draft.mandatory_tax_texts)}`);

assert.equal(draft.state, "DRAFT");
assert.equal(draft.invoice_number, null);
assert.ok(
  draft.nav_outcome === "NOT_CONFIGURED" || draft.nav_outcome === "NOT_REPORTABLE",
  `nav_outcome must be NOT_CONFIGURED or NOT_REPORTABLE, got ${draft.nav_outcome}`,
);
assert.equal(draft.series_id, TACITO_SERIES_ID);
assert.equal(draft.exemption_reason_code, "AAM");
assert.equal(draft.legal_basis_code, "HU_VAT_ACT_187");
assert.equal(draft.gross_total, "3500.00");
assert.ok(
  JSON.stringify(draft).includes("Áfa tv. 187. § szerinti alanyi adómentes"),
  "the mandatory AAM text must appear in the draft",
);
console.log("draft assertions: PASS (DRAFT, no number, AAM markers, mandatory text, ELOADO series)");

// ---------------------------------------------------------------------------
// (e) crash-recovery simulation (draft path only — no issuing)
// ---------------------------------------------------------------------------

section("e) crash recovery — replay createDraft with the SAME reference");
const replay = await client.createDraft(built.reference, built.payload);
assert.equal(replay.id, draft.id, "replaying <reference>:create must return the first draft, not a second one");
assert.equal(replay.state, "DRAFT");
console.log(`replay returned the SAME draft id (${replay.id === draft.id}) — create-step replay is idempotent`);

const ticket2 = { ...fakeTicket, id: TICKET_ID_2, code: makeCode() };
const built2 = buildTicketInvoice(fakeOrder, ticket2, fakeConcert);
const draft2 = await client.createDraft(built2.reference, built2.payload);
assert.notEqual(draft2.id, draft.id, "a different reference must create a different draft");
console.log(`different reference created a different draft (${draft2.id !== draft.id}) — the reference is the dedupe key`);

section("e2) storno-path read: invoiceDetail of the draft — related list (read-only)");
const detail = await client.invoiceDetail(draft.id);
assert.ok(Array.isArray(detail.related), "detail.related must be an array");
assert.deepEqual(detail.related, [], "a fresh draft has no related (storno) invoices");
console.log(`detail.related of the draft: ${JSON.stringify(detail.related)} — the read the storno pass uses to detect an existing storno (the storno write itself stays untested: the card forbids live stornos)`);

// ---------------------------------------------------------------------------
// (c) delete both drafts, confirm gone
// ---------------------------------------------------------------------------

section("c) delete the drafts and confirm they are gone");
await client.deleteDraft(draft.id);
await client.deleteDraft(draft2.id);
for (const [label, invoiceId] of [
  ["draft 1", draft.id],
  ["draft 2", draft2.id],
]) {
  let gone = false;
  try {
    await client.getInvoice(invoiceId);
  } catch (error) {
    gone = error.status === 404;
  }
  assert.ok(gone, `${label} must be gone (404) after DELETE`);
  console.log(`${label} deleted, GET now answers 404`);
}

// ---------------------------------------------------------------------------
// (d) products catalog: autosaved service name only, nothing else
// ---------------------------------------------------------------------------

section("d) GET /products — catalog after the drafts");
const productsAfter = await client.products();
const productNamesAfter = productsAfter.items.map((item) => item.name).sort();
console.log(`products after: ${JSON.stringify(productNamesAfter)}`);
const added = productNamesAfter.filter((name) => !productNamesBefore.includes(name));
const removed = productNamesBefore.filter((name) => !productNamesAfter.includes(name));
console.log(`added by this run: ${JSON.stringify(added)}`);
console.log(`removed by this run: ${JSON.stringify(removed)}`);
assert.deepEqual(removed, [], "no product may disappear");
for (const name of added) {
  assert.equal(
    name,
    "Előadó-művészeti tevékenység",
    "TACITo may only autosave the fixed service name as a product (no per-concert product)",
  );
}
console.log(
  `catalog check: PASS — only the fixed service name may appear (TACITo autosaves line descriptions; we create no product ourselves)`,
);

// ---------------------------------------------------------------------------
// (f) real routes on the dev server (auth + empty runs; zero TACITo writes)
// ---------------------------------------------------------------------------

section("f) routes on the dev server");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

// Health endpoint — auth.
const healthNoCookie = await getJson("/api/intern/tacito/status");
assert.equal(healthNoCookie.status, 401, "health endpoint without the intern cookie must be 401");
console.log("GET /api/intern/tacito/status without cookie -> 401 PASS");

const health = await getJson("/api/intern/tacito/status", { headers: { cookie: COOKIE } });
assert.equal(health.status, 200, `health endpoint must answer 200 (got ${health.status}: ${JSON.stringify(health.body)})`);
assert.ok(health.body && health.body.ok === true, `health payload ok:true (got: ${JSON.stringify(health.body).slice(0, 300)})`);
assert.equal(health.body.readiness.ready, true);
assert.equal(health.body.readiness.livemode, true);
assert.equal(health.body.readiness.nav_environment, "production");
assert.equal(health.body.readiness.production_allowed, true);
assert.deepEqual(health.body.readiness.missing, []);
assert.equal(health.body.series.id, TACITO_SERIES_ID);
assert.equal(health.body.series.name, "ELOADO");
assert.equal(health.body.series.prefix, "2026-J-");
assert.ok(health.body.series.next_number_preview);
assert.equal(health.body.series_mismatch, false);
assert.equal(health.body.auto_send_invoice_email, false);
assert.ok(typeof health.body.counts.issued_total === "number");
assert.ok(typeof health.body.counts.pending_tickets === "number");
assert.ok(typeof health.body.counts.nav_error_tickets === "number");
assert.ok(typeof health.body.counts.issued_today === "number");
assert.ok("last_error" in health.body);
console.log(`health payload: readiness.ready=true, NAV production, series ${health.body.series.name} ${health.body.series.prefix} (next ${health.body.series.next_number_preview}), mismatch=false, auto_send=false`);
console.log(`health counts: ${JSON.stringify(health.body.counts)} last_error: ${JSON.stringify(health.body.last_error)}`);

// Cron routes — auth.
const cronNoAuth = await getJson("/api/cron/tacito-invoices");
assert.equal(cronNoAuth.status, 401, "cron route without Authorization must be 401");
const cronBadAuth = await getJson("/api/cron/tacito-invoices", {
  headers: { authorization: "Bearer wrong-secret" },
});
assert.equal(cronBadAuth.status, 401, "cron route with a wrong secret must be 401");
console.log("cron routes without/with wrong secret -> 401 PASS");

const authHeaders = { authorization: `Bearer ${CRON_SECRET}` };
const invoicesRun = await getJson("/api/cron/tacito-invoices", { headers: authHeaders });
assert.equal(invoicesRun.status, 200, `invoices cron must answer 200 (got ${invoicesRun.status}: ${JSON.stringify(invoicesRun.body)})`);
assert.ok(invoicesRun.body.ok === true);
assert.deepEqual(
  { issued: invoicesRun.body.issued, failed: invoicesRun.body.failed, stornoed: invoicesRun.body.stornoed },
  { issued: 0, failed: 0, stornoed: 0 },
  "with a clean DB the invoices cron must be a no-op",
);
console.log(`GET /api/cron/tacito-invoices -> {issued:${invoicesRun.body.issued}, failed:${invoicesRun.body.failed}, stornoed:${invoicesRun.body.stornoed}, pending:${invoicesRun.body.pending}} (no-op run, zero TACITo writes)`);

const eventsRun = await getJson("/api/cron/tacito-events", { headers: authHeaders });
assert.equal(eventsRun.status, 200, `events cron must answer 200 (got ${eventsRun.status})`);
assert.ok(eventsRun.body.ok === true);
const { data: cursorRow } = await supabase.from("rk_tacito_cursor").select("next_cursor").eq("id", 1).maybeSingle();
assert.ok(cursorRow && typeof cursorRow.next_cursor === "string" && cursorRow.next_cursor.length > 0, "the events cron must persist a cursor");
console.log(`GET /api/cron/tacito-events -> {processed:${eventsRun.body.processed}, updated:${eventsRun.body.updated}, pages:${eventsRun.body.pages}} cursor persisted: ${JSON.stringify(cursorRow.next_cursor)}`);

const combinedRun = await getJson("/api/cron/tacito", { headers: authHeaders });
assert.equal(combinedRun.status, 200, `combined cron must answer 200 (got ${combinedRun.status})`);
assert.ok(combinedRun.body.ok === true && combinedRun.body.invoices && combinedRun.body.events_error === null);
console.log(`GET /api/cron/tacito -> invoices {issued:${combinedRun.body.invoices.issued}, pending:${combinedRun.body.invoices.pending}} + events {processed:${combinedRun.body.events.processed}} PASS`);

// ---------------------------------------------------------------------------
// Final proof: no issued invoice exists; account state unchanged
// ---------------------------------------------------------------------------

section("0) final proof — 0 real (issued) invoices");
const listAfter = await client.listInvoices();
const issuedAfter = (Array.isArray(listAfter) ? listAfter : []).filter((item) => item.state === "ISSUED");
console.log(`invoice list after: ${Array.isArray(listAfter) ? listAfter.length : 0} item(s), of which ISSUED: ${issuedAfter.length}`);
assert.equal(issuedAfter.length, issuedBefore.length, "this run must not have issued any invoice");
assert.equal(issuedAfter.length, realIssuedInvoices, "the issued-invoice count must be unchanged");
console.log("REAL (issued) invoices created by this run: 0");

console.log("\nALL CHECKS PASSED");
