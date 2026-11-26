// Card 09 — ticket e-mail design verification (OFFLINE, nothing is sent).
//
// Renders the HTML + plain-text parts with a fixture order, writes the HTML
// to a file for visual inspection, and asserts the card 09 design contract:
//   - the brand palette values from app/globals.css appear in the HTML
//     (#0e2016 card, #e6d5a3 gold, #06100a page, #1a3828 border, #f5f0e4
//     cream, #9aa79e muted labels);
//   - the RÉZ KÖRÚT wordmark is letter-spaced gold TEXT;
//   - exactly one cid: QR image per ticket and no data: URI anywhere;
//   - dashed #1a3828 separators, the QR frame (cream square, 12 px padding,
//     1 px gold border), the monospace letter-spaced code;
//   - the media-query <style> block stacks the facts and puts the QR above
//     the code (DOM order) on mobile;
//   - footer contact line + exactly one számla sentence, no emoji, no
//     social icons, no tracking pixel (no remote <img> at all);
//   - the plain-text part mirrors the facts („Jegyei:” list, codes, total);
//   - the GENERATED QR PNGs are exactly two-colour (#0b1a10 on #f5f0e4,
//     640 px) and jsQR decodes each back to https://rezkorut.hu/j/<code>.
//
// Run from the repo root: node scripts/card09-email-check.mjs
// Fixture HTML is written to $CARD09_OUT_DIR (default: Hermes scratch dir).

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT_DIR =
  process.env.CARD09_OUT_DIR || "/home/denandras/.hermes/profiles/coder/cache/scratch/card09";

const FIXTURE = {
  orderId: "00000000-0000-4000-8000-000000000009",
  buyerName: "Teszt Vásárló",
  buyerEmail: "contact@andrasdenes.com",
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

const emailLib = await import("../lib/ticket-email.ts");
const { jsQR } = { jsQR: (await import("jsqr")).default };

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

console.log("== card 09 — offline e-mail design check ==");
const html = emailLib.buildTicketEmailHtml(FIXTURE);
const text = emailLib.buildTicketEmailText(FIXTURE);
mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = `${OUT_DIR}/card09-fixture.html`;
writeFileSync(htmlPath, html);
writeFileSync(`${OUT_DIR}/card09-fixture.txt`, text);
console.log(`fixture HTML written: ${htmlPath} (${html.length} bytes)`);

// --- palette (exact values from app/globals.css) ---
for (const color of ["#0e2016", "#e6d5a3", "#06100a", "#1a3828", "#f5f0e4", "#9aa79e"]) {
  assert.ok(html.includes(color), `the HTML must carry the brand colour ${color}`);
  console.log(`palette ${color} present`);
}

// --- header: wordmark as text + gold rule ---
assert.ok(html.includes("RÉZ KÖRÚT"), "the RÉZ KÖRÚT wordmark must be text in the header");
assert.ok(/letter-spacing:0\.3\dem[^"]*text-transform:uppercase/.test(html), "the wordmark must be letter-spaced uppercase");
assert.ok(count(html, "background-color:#e6d5a3") >= 1, "a gold rule must exist");
assert.ok(html.includes("height:2px"), "the gold rule must be 2 px");
assert.ok(html.includes("Köszönjük a vásárlást!"), "the greeting must be present");
assert.ok(html.includes(FIXTURE.concert.title), "the concert title must be present");

// --- fonts ---
assert.ok(html.includes("'Lexend Deca','Helvetica Neue',Helvetica,Arial,sans-serif"), "the text font stack must be the brand stack");
assert.ok(html.includes("'Courier New'"), "the code must be monospace Courier New");
assert.ok(!html.includes("fonts.googleapis"), "no webfont loading (Gmail strips it)");

// --- one <style> block, media queries only there ---
assert.equal(count(html, "<style"), 1, "exactly one <style> block");
assert.ok(html.includes("@media only screen and (max-width:620px)"), "the media query must target phone widths");
for (const cls of ["em-p", "em-fl", "em-fv", "em-qr", "em-tk"]) {
  assert.ok(html.includes(`.${cls} {`), `the media query must restyle .${cls}`);
}
assert.ok(html.includes(".em-fl { display:block") && html.includes(".em-fv { display:block"), "the concert facts must stack into one column on mobile");

// --- per ticket: exactly one cid: image, dashed separator, DOM order ---
assert.equal(count(html, 'src="cid:'), FIXTURE.tickets.length, "one cid: image per ticket");
assert.equal(count(html, "<img "), FIXTURE.tickets.length, "no other images (no logo, no tracking pixel)");
assert.ok(!html.includes("data:"), "no data: URI anywhere in the HTML");
assert.equal(count(html, "border-top:1px dashed #1a3828"), FIXTURE.tickets.length, "a dashed #1a3828 separator per ticket");
for (const [i, ticket] of FIXTURE.tickets.entries()) {
  const label = `Jegy ${i + 1}/${FIXTURE.tickets.length}`;
  const labelIdx = html.indexOf(label);
  assert.ok(labelIdx >= 0, `the ticket must carry the numbered label ${label}`);
  assert.ok(html.includes("font-variant:small-caps"), "the ticket label must be small caps");
  const imgIdx = html.indexOf(`cid:qr-${ticket.code}@rezkorut`, labelIdx);
  const codeIdx = html.indexOf(ticket.code, imgIdx);
  assert.ok(imgIdx > labelIdx && codeIdx > imgIdx, `ticket ${i + 1}: the QR must come before the code in DOM order (stacks above on mobile)`);
  assert.ok(html.includes(ticket.ticket_type_name), `ticket ${i + 1}: the type must be shown`);
}
assert.ok(count(html, "letter-spacing:0.12em") >= FIXTURE.tickets.length, "the code must be letter-spaced 0.12em");
assert.ok(html.includes('dir="rtl"'), "the QR sits on the right via the dir=rtl pair table");

// --- QR frame ---
assert.ok(html.includes("background-color:#f5f0e4"), "the QR frame must be cream");
assert.ok(html.includes("border:1px solid #e6d5a3"), "the QR frame must have a 1 px gold border");
assert.ok(html.includes("padding:12px"), "the QR frame must have 12 px padding");

// --- facts block ---
assert.ok(html.includes("Dátum"), "the facts block must have a Dátum label");
assert.ok(html.includes("2026. november 27., 18:00"), "the date+time must follow the glossary format");
assert.ok(html.includes("Helyszín"), "the facts block must have a Helyszín label");
assert.ok(html.includes("Budapest Music Center"), "the venue must be shown");

// --- total ---
assert.ok(html.includes("Fizetett összeg"), "the paid total must be shown");
assert.ok(html.includes("8\u00a0000 Ft"), "the total must be 8 000 Ft (NBSP-grouped)");

// --- footer ---
assert.ok(html.includes("rezkorut.hu"), "the footer must link rezkorut.hu");
assert.ok(html.includes("contact@andrasdenes.com"), "the footer must show contact@andrasdenes.com");
assert.equal(count(html, "Ez a levél nem számla"), 1, "exactly one sentence about the számla");
assert.ok(html.includes("számlázási rendszerünktől"), "the footer must say the számla arrives separately");

// --- hygiene ---
const emoji = /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u;
assert.ok(!emoji.test(html) && !emoji.test(text), "no emoji");
assert.ok(!/facebook|instagram|twitter|linkedin|tiktok/i.test(html), "no social icons");
assert.ok(!/src="http/.test(html), "no remote images (no tracking pixel)");

// --- glossary-forbidden terms ---
const forbidden = /early bird|check-?in|scan|refund|dashboard|ticket type|sold out|kosár|árusítás/i;
assert.ok(!forbidden.test(html), "no glossary-forbidden term in the HTML");
assert.ok(!forbidden.test(text), "no glossary-forbidden term in the text part");

// --- plain-text part mirrors the design facts ---
assert.ok(text.includes("Jegyei:"), "the text part must keep the „Jegyei:” list");
for (const ticket of FIXTURE.tickets) {
  assert.ok(text.includes(ticket.code), "the text part must show every code");
  assert.ok(text.includes(emailLib.ticketUrl(ticket.code)), "the text part must carry every /j/ link");
}
assert.ok(text.includes("Fizetett összeg: 8\u00a0000 Ft"), "the text part must show the total");
assert.ok(text.includes("2026. november 27., 18:00"), "the text part must show the glossary date+time");
assert.ok(text.includes("Budapest Music Center"), "the text part must show the venue");
assert.ok(text.includes("Ez a levél nem számla"), "the text part must say it is not the számla");

// --- generated QR PNGs: two-colour brand QR + jsQR decode (offline proof) ---
const pngs = await emailLib.ticketQrPngs(FIXTURE.tickets);
for (const ticket of FIXTURE.tickets) {
  const png = pngs.get(ticket.code);
  assert.ok(Buffer.isBuffer(png) && png.length > 1000, `a QR PNG must exist for ${ticket.code}`);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 640, "the QR source PNG must be 640 px wide (crisp when scaled down)");
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  assert.equal(colors.size, 2, "the QR PNG must be exactly two-colour");
  assert.ok(colors.has("11,26,16"), "the QR dark colour must be #0b1a10 (deep forest)");
  assert.ok(colors.has("245,240,228"), "the QR light colour must be #f5f0e4 (cream)");
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.equal(
    result && result.data,
    emailLib.ticketUrl(ticket.code),
    `jsQR must decode the generated QR for ${ticket.code} back to the /j/ URL`,
  );
  console.log(`QR ${ticket.code}: exactly #0b1a10-on-#f5f0e4, 640 px — jsQR decodes: ${result.data}`);
}

console.log("\nOK — card 09 offline design check passed.");
console.log(`Inspect the fixture at: ${htmlPath}`);
