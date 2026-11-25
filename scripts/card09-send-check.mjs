// Card 09 — REAL e-mail proof: send + receive + jsQR decode of the RECEIVED
// attachment.
//
// This script sends ONE real ticket e-mail through Purelymail SMTP, with the
// buyer address set to ORDER_CC (the owner's own mailbox,
// contact@andrasdenes.com — never an invented buyer address). It then waits
// for the message to appear in that mailbox, exports the RECEIVED raw message
// via the configured himalaya CLI (IMAP account `contact` — no credentials
// are read or stored here), extracts the inline QR PNG attachments from the
// received MIME and decodes them with jsQR. Each QR must decode to
// https://rezkorut.hu/j/<code>.
//
// It also checks what the receiving client actually renders: the received
// HTML part must carry the RÉZ KÖRÚT wordmark and must reference every QR by
// the received Content-ID.
//
// This SENDS a real e-mail — do not run casually.
// Run from the repo root: node scripts/card09-send-check.mjs
//   node scripts/card09-send-check.mjs decode <received.eml>
//     re-runs only the receive-side proof (part walk + jsQR decode) against
//     an already-received raw message — no second e-mail is sent.
// Artifacts land in $CARD09_OUT_DIR (default: Hermes scratch dir).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const OUT_DIR =
  process.env.CARD09_OUT_DIR || "/home/denandras/.hermes/profiles/coder/cache/scratch/card09";

const FIXTURE = {
  orderId: "00000000-0000-4000-8000-000000000009",
  buyerName: "Teszt Vásárló",
  buyerEmail: "", // set below from ORDER_CC — never an invented buyer address
  concert: {
    title: "Réz körút – Rézfúvós kamaraest",
    event_date: "2026-11-27",
    event_time: "18:00",
    venue: "Budapest Music Center",
    location: "Budapest",
  },
  tickets: [
    { code: "CRD09TST01", ticket_type_name: "Teljes árú jegy", price_huf: 4500 },
    { code: "CRD09TST02", ticket_type_name: "Elővételes jegy", price_huf: 3500 },
  ],
};

// ---------------------------------------------------------------------------
// Environment (same .env.local the dev server reads — quoted values)
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
for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "ORDER_CC"]) {
  if (!process.env[key] && fileEnv[key]) process.env[key] = fileEnv[key];
}

const ORDER_CC = env("ORDER_CC");
assert.ok(ORDER_CC, "ORDER_CC must be configured (SMTP proof requires it)");
FIXTURE.buyerEmail = ORDER_CC;

const emailLib = await import("../lib/ticket-email.ts");
const jsQR = (await import("jsqr")).default;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// himalaya (IMAP account `contact` — configured outside this repo)
// ---------------------------------------------------------------------------

function listEnvelopes() {
  const out = execFileSync("himalaya", ["envelope", "list", "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Minimal raw-MIME walk (stdlib-only): split on boundaries, collect leaf parts
// ---------------------------------------------------------------------------

function parsePart(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return { headers: raw, body: "" };
  return { headers: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function headerValue(headers, name) {
  // RFC 5322 unfolding: parameter lines fold with leading whitespace
  // (e.g. `Content-Type: multipart/alternative;\r\n boundary="…"`).
  const flat = headers.replace(/\r?\n[ \t]+/g, " ");
  const match = flat.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : null;
}

function splitParts(body, boundary) {
  const parts = [];
  const chunks = body.split(`--${boundary}`);
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].startsWith("--")) break; // closing boundary
    parts.push(chunks[i].replace(/^\r?\n/, ""));
  }
  return parts;
}

function collectParts(raw, acc) {
  const { headers, body } = parsePart(raw);
  const contentType = headerValue(headers, "Content-Type") || "";
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (boundaryMatch) {
    for (const sub of splitParts(body, boundaryMatch[1])) collectParts(sub, acc);
    return;
  }
  acc.push({
    contentType,
    contentId: headerValue(headers, "Content-ID"),
    encoding: headerValue(headers, "Content-Transfer-Encoding") || "7bit",
    body,
  });
}

function qpDecode(input) {
  const noSoft = input.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < noSoft.length; i++) {
    const ch = noSoft[i];
    if (ch === "=" && /^[0-9A-F]{2}$/i.test(noSoft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(noSoft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodePart(part) {
  const enc = part.encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(part.body.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") return qpDecode(part.body);
  return Buffer.from(part.body, "utf8");
}

// ---------------------------------------------------------------------------
// Proof
// ---------------------------------------------------------------------------

console.log("== card 09 — REAL send + received-attachment jsQR proof ==");
const subject = `Jegyek — ${FIXTURE.concert.title}`;
const decodeOnly = process.argv[2] === "decode";
const decodePath = decodeOnly ? process.argv[3] : null;

let emlPath;
let eml;

if (decodeOnly) {
  emlPath = decodePath;
  assert.ok(emlPath && existsSync(emlPath), `decode mode needs an existing .eml file (got: ${decodePath})`);
  eml = readFileSync(emlPath, "utf8");
  console.log(`decode-only mode: re-proving the already-received raw message ${emlPath} (${eml.length} bytes) — no e-mail is sent`);
} else {
  console.log("capturing pre-send INBOX envelope ids…");
  const beforeIds = new Set(listEnvelopes().map((entry) => entry.id));

  console.log(`sending ONE real e-mail to ORDER_CC (${ORDER_CC})…`);
  const result = await emailLib.sendTicketEmail(FIXTURE);
  console.log("send result:", JSON.stringify({ ...result }, null, 2));
  assert.equal(result.ok, true, "the real SMTP send must succeed");
  assert.ok(!result.skipped, "the send must not be skipped (SMTP must be configured)");
  assert.ok((result.accepted || []).length > 0, "the SMTP server must accept the message");

  console.log("waiting for the message to arrive on IMAP…");
  let received = null;
  for (let attempt = 1; attempt <= 18 && !received; attempt++) {
    await sleep(attempt === 1 ? 8000 : 10000);
    const envelopes = listEnvelopes();
    received = envelopes.find((entry) => entry.subject === subject && !beforeIds.has(entry.id)) || null;
    if (!received) console.log(`  attempt ${attempt}: not there yet…`);
  }
  assert.ok(received, "the sent e-mail must arrive in the ORDER_CC mailbox");
  console.log(`received as envelope id ${received.id} (dated ${received.date})`);

  const exportDir = `${OUT_DIR}/received`;
  mkdirSync(exportDir, { recursive: true });
  execFileSync("himalaya", ["message", "export", String(received.id), "--full", "-d", exportDir]);
  const emlName = readdirSync(exportDir).filter((f) => f.toLowerCase().endsWith(".eml"))[0];
  assert.ok(emlName, "the export must produce the raw .eml file");
  emlPath = `${exportDir}/${emlName}`;
  eml = readFileSync(emlPath, "utf8");
  console.log(`received raw message: ${emlPath} (${eml.length} bytes)`);
}

const parts = [];
collectParts(eml, parts);
console.log(`MIME parts found: ${parts.length}`);

// --- the received HTML part must be the brand design ---
const htmlPart = parts.find((p) => (p.contentType || "").includes("text/html"));
assert.ok(htmlPart, "the received message must have an HTML part");
const receivedHtml = decodePart(htmlPart).toString("utf8");
assert.ok(receivedHtml.includes("RÉZ KÖRÚT"), "the received HTML must carry the RÉZ KÖRÚT wordmark");
assert.ok(receivedHtml.includes("#0e2016") && receivedHtml.includes("#e6d5a3"), "the received HTML must carry the brand palette");

// --- decode every RECEIVED QR attachment ---
for (const ticket of FIXTURE.tickets) {
  const part = parts.find((p) => (p.contentId || "").includes(`qr-${ticket.code}@rezkorut`));
  assert.ok(part, `the received message must carry the inline QR for ${ticket.code} with its Content-ID`);
  assert.ok(receivedHtml.includes(`cid:qr-${ticket.code}@rezkorut`), `the received HTML must reference the ${ticket.code} QR by its Content-ID`);

  const png = decodePart(part);
  assert.equal(png.subarray(0, 4).toString("hex"), "89504e47", `the received QR for ${ticket.code} must be a PNG`);

  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  const expected = emailLib.ticketUrl(ticket.code);
  assert.equal(decoded && decoded.data, expected, `the RECEIVED QR for ${ticket.code} must decode to ${expected}`);
  console.log(`RECEIVED attachment for ${ticket.code} (PNG ${png.length} bytes, ${info.width}px) jsQR-decodes to: ${decoded.data}`);
}

console.log(
  decodeOnly
    ? "\nOK — received-attachment decode proof passed (the real e-mail was sent by the earlier full run)."
    : "\nOK — real e-mail proof passed: SMTP send → INBOX arrival → received QR attachments decode to https://rezkorut.hu/j/<code>.",
);
console.log("The message stays in the INBOX (contact@andrasdenes.com) for visual inspection in a real client.");
