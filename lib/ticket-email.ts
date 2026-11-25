import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import QRCode from "qrcode";

/**
 * Ticket e-mail for a paid order (card 03, rebuilt to the Réz körút brand in
 * card 09): Hungarian, no emoji, table-based dark design carrying the site
 * palette from app/globals.css — charcoal `#06100a` page, `#0e2016` card with
 * a 1 px `#1a3828` border, gold `#e6d5a3` accents, cream `#f5f0e4` text and
 * muted `#9aa79e` labels. The wordmark is letter-spaced gold TEXT, never an
 * image; the font stack is 'Lexend Deca' with system fallbacks (Gmail strips
 * webfont loading, so the stack is the design); only the ticket code uses
 * 'Courier New'.
 *
 * Transport: Purelymail SMTP through the contact@andrasdenes.com mailbox —
 * the same pattern as ~/projects/yellowsky/lib/email.ts. Env: SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ORDER_CC. If SMTP is not
 * configured the send returns a skipped result instead of throwing — a
 * missing mailer must never break a paid order (the webhook stays 200 and
 * `emailed_at` stays null for a later retry).
 *
 * The QR PNG is generated with qrcode.toBuffer (errorCorrectionLevel H,
 * margin 2, width 640, dark #0b1a10 on light #f5f0e4 — no logo is ever drawn
 * inside the code) and attached through a `cid:` reference: Gmail strips
 * data: URIs from HTML bodies, so an inline attachment is the mechanism that
 * actually renders there. The QR sits in a cream square (12 px padding, 1 px
 * gold border) to the right of the code, and stacks ABOVE it under 620 px.
 * The code text and the /j/<code> link are always present too, so the ticket
 * is usable even with images blocked.
 *
 * All visual styles are inline; the single <style> block carries only the
 * media queries (facts into one column, QR above the code, tighter side
 * padding) for phone widths down to 320 px.
 *
 * This e-mail is NOT the invoice — the footer says so in exactly one
 * sentence and says the számla arrives separately from the invoicing system
 * (TACITo, card 04).
 */

const TICKET_URL_BASE = "https://rezkorut.hu/j/";

/** Public per-ticket landing page (`/j/<code>`). */
export function ticketUrl(code: string): string {
  return `${TICKET_URL_BASE}${code}`;
}

let cached: Transporter | null = null;

type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  cc: string;
};

function config(): MailConfig | null {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || "Réz körút <contact@andrasdenes.com>";
  const cc = process.env.ORDER_CC || "contact@andrasdenes.com";
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from, cc };
}

function transporter(cfg: MailConfig): Transporter {
  if (!cached) {
    const options: SMTPTransport.Options = {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    };
    cached = nodemailer.createTransport(options);
  }
  return cached;
}

export type TicketEmailTicket = {
  code: string;
  ticket_type_name: string | null;
  price_huf: number;
};

export type TicketEmailData = {
  orderId: string;
  buyerName: string | null;
  buyerEmail: string;
  concert: {
    title: string;
    event_date: string | null;
    event_time: string | null;
    venue: string | null;
    location: string | null;
  };
  tickets: TicketEmailTicket[];
};

export type TicketEmailResult = {
  ok: boolean;
  skipped?: boolean;
  accepted?: string[];
  rejected?: string[];
  messageId?: string;
  error?: string;
};

// Brand palette from app/globals.css (card 09 design contract — exact values).
const GOLD = "#e6d5a3";
const FOREST = "#0b1a10";
const CARD_BG = "#0e2016";
const BORDER = "#1a3828";
const CREAM = "#f5f0e4";
const CHARCOAL = "#06100a";
const MUTED = "#9aa79e";

const SANS = "'Lexend Deca','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "4 500 Ft" with a non-breaking-space thousands separator (glossary format). */
function money(huf: number): string {
  const grouped = String(huf).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${grouped} Ft`;
}

function huDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function concertFacts(data: TicketEmailData): { title: string; when: string; where: string } {
  const title = data.concert.title;
  // Glossary date format: „2026. november 27., 18:00” — month lowercase, dot
  // after the day, time with a colon, joined by „, ”.
  const when = [data.concert.event_date ? huDate(data.concert.event_date) : "", data.concert.event_time ?? ""]
    .filter(Boolean)
    .join(", ");
  const where = [data.concert.venue, data.concert.location].filter(Boolean).join(", ");
  return { title, when, where };
}

export function buildTicketEmailText(data: TicketEmailData): string {
  const facts = concertFacts(data);
  const lines: string[] = [];
  lines.push("Köszönjük a vásárlást!");
  lines.push("");
  lines.push(facts.title);
  if (facts.when) lines.push(facts.when);
  if (facts.where) lines.push(facts.where);
  lines.push("");
  lines.push("Jegyei:");
  for (const ticket of data.tickets) {
    const type = ticket.ticket_type_name ? `${ticket.ticket_type_name} — ` : "";
    lines.push(`- ${type}${ticket.code} (${money(ticket.price_huf)})`);
    lines.push(`  ${ticketUrl(ticket.code)}`);
  }
  lines.push("");
  lines.push(`Fizetett összeg: ${money(data.tickets.reduce((sum, ticket) => sum + ticket.price_huf, 0))}`);
  lines.push("");
  lines.push("Ez a levél nem számla: a számlát a számlázási rendszerünktől külön e-mailben kapja.");
  lines.push("A koncertre a jegykód mutatásával, nyomtatva vagy a telefonjáról is beléphet.");
  lines.push("");
  lines.push("Réz körút");
  lines.push("https://rezkorut.hu");
  lines.push("contact@andrasdenes.com");
  return lines.join("\n");
}

/**
 * Brand QR PNG per ticket: errorCorrectionLevel H, margin 2, width 640,
 * dark #0b1a10 on light #f5f0e4, never a logo inside the code. Returned as
 * raw PNG buffers for the `cid:` attachments (no data: URI anywhere).
 */
export async function ticketQrPngs(tickets: TicketEmailTicket[]): Promise<Map<string, Buffer>> {
  const pngs = new Map<string, Buffer>();
  for (const ticket of tickets) {
    pngs.set(
      ticket.code,
      await QRCode.toBuffer(ticketUrl(ticket.code), {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 640,
        color: { dark: FOREST, light: CREAM },
      }),
    );
  }
  return pngs;
}

/**
 * The <style> block carries ONLY the media queries — everything else is
 * inline. Under 620 px: tighter side padding, the concert facts stack into
 * one column (label above value) and each ticket's QR moves ABOVE its code
 * (the QR cell is first in the DOM; `display:block` makes the dir="rtl"
 * pair-stack fall back to reading order).
 */
const MEDIA_QUERIES = `
  @media only screen and (max-width:620px) {
    .em-p { padding-left:18px !important; padding-right:18px !important; }
    .em-fl { display:block !important; width:auto !important; padding:2px 0 0 0 !important; }
    .em-fv { display:block !important; width:auto !important; padding:2px 0 6px 0 !important; }
    .em-qr { display:block !important; width:auto !important; padding:0 0 14px 0 !important; }
    .em-tk { display:block !important; width:auto !important; padding:0 !important; }
  }`;

export function buildTicketEmailHtml(data: TicketEmailData): string {
  const facts = concertFacts(data);
  const total = data.tickets.reduce((sum, ticket) => sum + ticket.price_huf, 0);

  const factRow = (label: string, value: string): string => `
        <tr>
          <td class="em-fl" width="110" style="width:110px;vertical-align:top;padding:4px 12px 4px 0;font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${esc(label)}</td>
          <td class="em-fv" style="vertical-align:top;padding:4px 0;font-family:${SANS};font-size:14px;line-height:1.5;color:${CREAM};">${esc(value)}</td>
        </tr>`;

  const factRows = [
    facts.when ? factRow("Dátum", facts.when) : "",
    facts.where ? factRow("Helyszín", facts.where) : "",
  ]
    .filter(Boolean)
    .join("");

  const ticketBlocks = data.tickets
    .map((ticket, index) => {
      const cid = `qr-${ticket.code}@rezkorut`;
      const typeLine = ticket.ticket_type_name
        ? `<span style="color:${CREAM};font-weight:600;">${esc(ticket.ticket_type_name)}</span><span style="color:${MUTED};">&nbsp;&middot;&nbsp;</span><span style="color:${CREAM};font-weight:600;">${esc(money(ticket.price_huf))}</span>`
        : `<span style="color:${CREAM};font-weight:600;">${esc(money(ticket.price_huf))}</span>`;
      return `
        <tr>
          <td class="em-p" style="padding:20px 32px 22px 32px;border-top:1px dashed ${BORDER};">
            <div style="font-family:${SANS};font-size:12px;letter-spacing:0.16em;font-variant:small-caps;color:${GOLD};">Jegy ${index + 1}/${data.tickets.length}</div>
            <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
              <tr>
                <td class="em-qr" dir="ltr" width="136" style="width:136px;vertical-align:middle;">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                    <tr>
                      <td style="background-color:${CREAM};border:1px solid ${GOLD};padding:12px;">
                        <img src="cid:${esc(cid)}" width="110" height="110" alt="QR-kód: ${esc(ticket.code)}" style="display:block;width:110px;height:110px;border:0;" />
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="em-tk" dir="ltr" style="vertical-align:middle;padding:0 16px 0 0;">
                  <div style="font-family:${SANS};font-size:14px;line-height:1.5;">${typeLine}</div>
                  <div style="font-family:${MONO};font-size:17px;font-weight:700;letter-spacing:0.12em;color:${CREAM};padding-top:4px;">${esc(ticket.code)}</div>
                  <div style="font-family:${SANS};font-size:12px;line-height:1.6;padding-top:8px;">
                    <a href="${esc(ticketUrl(ticket.code))}" style="color:${MUTED};text-decoration:none;border-bottom:1px solid ${BORDER};">${esc(ticketUrl(ticket.code))}</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
    <meta name="color-scheme" content="dark" />
    <title>Jegyek — ${esc(facts.title)}</title>
    <style>${MEDIA_QUERIES}</style>
  </head>
  <body style="margin:0;padding:0;background-color:${CHARCOAL};-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${CHARCOAL};">
      <tr>
        <td align="center" style="padding:28px 10px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:${CARD_BG};border:1px solid ${BORDER};border-collapse:separate;">
            <tr>
              <td class="em-p" style="padding:30px 32px 0 32px;font-family:${SANS};">
                <div style="font-size:14px;font-weight:700;letter-spacing:0.32em;text-transform:uppercase;color:${GOLD};">RÉZ KÖRÚT</div>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                  <tr>
                    <td style="height:2px;width:44px;background-color:${GOLD};font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="em-p" style="padding:20px 32px 0 32px;font-family:${SANS};">
                <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${CREAM};">Köszönjük a vásárlást!</h1>
                <div style="font-size:17px;line-height:1.4;font-weight:600;color:${CREAM};padding-top:6px;">${esc(facts.title)}</div>
              </td>
            </tr>
            ${
              factRows
                ? `<tr>
              <td class="em-p" style="padding:18px 32px 0 32px;font-family:${SANS};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${factRows}
                </table>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td class="em-p" style="padding:14px 32px 0 32px;font-family:${SANS};">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">A koncertre a jegykód mutatásával, nyomtatva vagy a telefonjáról is beléphet.</p>
              </td>
            </tr>
            ${ticketBlocks}
            <tr>
              <td class="em-p" align="right" style="padding:8px 32px 24px 32px;font-family:${SANS};">
                <span style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">Fizetett összeg</span>
                <span style="font-size:16px;font-weight:700;color:${CREAM};padding-left:10px;white-space:nowrap;">${esc(money(total))}</span>
              </td>
            </tr>
            <tr>
              <td class="em-p" style="padding:18px 32px 30px 32px;font-family:${SANS};border-top:1px solid ${BORDER};">
                <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">Ez a levél nem számla: a számlát a számlázási rendszerünktől külön e-mailben kapja.</p>
                <p style="margin:10px 0 0 0;font-size:12px;line-height:1.7;color:${MUTED};">
                  <a href="https://rezkorut.hu" style="color:${MUTED};text-decoration:none;">rezkorut.hu</a>
                  <span>&nbsp;&middot;&nbsp;</span>
                  <a href="mailto:contact@andrasdenes.com" style="color:${MUTED};text-decoration:none;">contact@andrasdenes.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Sends the ticket e-mail: buyer in to, ORDER_CC in cc, reply-to ORDER_CC.
 * Never throws — a mail failure is reported in the result and the caller
 * (the fulfilment) leaves `emailed_at` null.
 */
export async function sendTicketEmail(data: TicketEmailData): Promise<TicketEmailResult> {
  const cfg = config();
  if (!cfg) {
    console.warn("[ticket-email] SMTP not configured, skipping ticket e-mail for order", data.orderId);
    return { ok: false, skipped: true, error: "SMTP not configured" };
  }
  if (!data.buyerEmail) {
    console.warn("[ticket-email] no buyer e-mail on order", data.orderId, "— skipping send");
    return { ok: false, skipped: true, error: "no buyer e-mail" };
  }
  try {
    const pngs = await ticketQrPngs(data.tickets);
    const attachments = data.tickets.map((ticket) => ({
      filename: `jegy-${ticket.code}.png`,
      content: pngs.get(ticket.code) ?? Buffer.alloc(0),
      contentType: "image/png",
      cid: `qr-${ticket.code}@rezkorut`,
    }));

    const info = await transporter(cfg).sendMail({
      from: cfg.from,
      to: data.buyerEmail,
      cc: cfg.cc,
      replyTo: cfg.cc,
      subject: `Jegyek — ${concertFacts(data).title}`,
      text: buildTicketEmailText(data),
      html: buildTicketEmailHtml(data),
      attachments,
    });

    const toAddress = (entry: unknown): string =>
      typeof entry === "string" ? entry : String((entry as { address?: unknown }).address ?? entry);
    const accepted = [...(info.accepted ?? [])].map(toAddress);
    const rejected = [...(info.rejected ?? [])].map(toAddress);
    return { ok: true, accepted, rejected, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ticket-email] ticket e-mail failed for order", data.orderId, message);
    return { ok: false, error: message };
  }
}
