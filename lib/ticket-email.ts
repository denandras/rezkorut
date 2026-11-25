import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import QRCode from "qrcode";

/**
 * Ticket e-mail for a paid order (card 03): Hungarian, no emoji, plain
 * table-based HTML that renders in Gmail, one block per ticket with its code
 * and an inline QR PNG pointing at https://rezkorut.hu/j/<code>.
 *
 * Transport: Purelymail SMTP through the contact@andrasdenes.com mailbox —
 * the same pattern as ~/projects/yellowsky/lib/email.ts. Env: SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ORDER_CC. If SMTP is not
 * configured the send returns a skipped result instead of throwing — a
 * missing mailer must never break a paid order (the webhook stays 200 and
 * `emailed_at` stays null for a later retry).
 *
 * The QR PNG is generated with qrcode.toDataURL, then attached through a
 * `cid:` reference: Gmail strips data: URIs from HTML bodies, so an inline
 * attachment is the mechanism that actually renders there. The code text and
 * the /j/<code> link are always present too, so the ticket is usable even
 * with images blocked.
 *
 * This e-mail is NOT the invoice — it says so, and says the számla arrives
 * separately from the invoicing system (TACITo, card 04).
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

const GREEN = "#1e4d40";
const GOLD = "#b9975b";
const INK = "#1d2523";
const MUTED = "#5c6a66";
const BORDER = "#dfe5e2";

const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(huf: number): string {
  return `${new Intl.NumberFormat("hu-HU").format(huf)} Ft`;
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
  const when = [
    data.concert.event_date ? huDate(data.concert.event_date) : "",
    data.concert.event_time ? `${data.concert.event_time} óra` : "",
  ]
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
  lines.push("A koncertre a kód mutatásával, nyomtatva vagy a telefonjáról is beléphet.");
  lines.push("");
  lines.push("Réz körút");
  lines.push("https://rezkorut.hu");
  return lines.join("\n");
}

export function buildTicketEmailHtml(data: TicketEmailData): string {
  const facts = concertFacts(data);
  const total = data.tickets.reduce((sum, ticket) => sum + ticket.price_huf, 0);

  const ticketBlocks = data.tickets
    .map((ticket) => {
      const cid = `qr-${ticket.code}@rezkorut`;
      const type = ticket.ticket_type_name
        ? `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};padding-bottom:2px;">${esc(ticket.ticket_type_name)} &middot; ${money(ticket.price_huf)}</div>`
        : `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};padding-bottom:2px;">${money(ticket.price_huf)}</div>`;
      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid ${BORDER};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;padding-right:16px;">
                  <img src="cid:${cid}" width="110" height="110" alt="Jegy kód: ${esc(ticket.code)}" style="display:block;width:110px;height:110px;border:1px solid ${BORDER};" />
                </td>
                <td style="vertical-align:middle;">
                  ${type}
                  <div style="font-family:${MONO};font-size:19px;font-weight:700;letter-spacing:0.12em;color:${GREEN};">${esc(ticket.code)}</div>
                  <div style="font-family:${SANS};font-size:12px;line-height:1.6;padding-top:6px;">
                    <a href="${esc(ticketUrl(ticket.code))}" style="color:${GREEN};text-decoration:none;border-bottom:1px solid ${GOLD};">${esc(ticketUrl(ticket.code))}</a>
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
    <meta name="color-scheme" content="light" />
    <title>Jegyek — ${esc(facts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f1;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};">
            <tr>
              <td style="padding:26px 30px 0 30px;">
                <div style="font-family:${SANS};font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:${INK};font-weight:700;">Réz körút</div>
                <div style="height:3px;width:44px;background:${GOLD};margin-top:10px;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px 0 30px;font-family:${SANS};">
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:${INK};font-weight:700;">Köszönjük a vásárlást!</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 30px 0 30px;font-family:${SANS};">
                <div style="font-size:16px;line-height:1.5;color:${GREEN};font-weight:700;">${esc(facts.title)}</div>
                <div style="font-size:14px;line-height:1.6;color:${MUTED};padding-top:4px;">
                  ${facts.when ? `${esc(facts.when)}<br />` : ""}${facts.where ? esc(facts.where) : ""}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px 0 30px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${ticketBlocks}
                </table>
              </td>
            </tr>
            <tr>
              <td align="right" style="padding:16px 30px 0 30px;font-family:${SANS};">
                <span style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${INK};font-weight:700;">Fizetett összeg</span>
                <span style="font-size:16px;color:${INK};font-weight:600;padding-left:10px;white-space:nowrap;">${esc(money(total))}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px 0 30px;"><div style="height:1px;background:${BORDER};"></div></td>
            </tr>
            <tr>
              <td style="padding:16px 30px 28px 30px;font-family:${SANS};">
                <p style="margin:0;font-size:13px;line-height:1.65;color:${MUTED};">
                  Ez a levél nem számla: a számlát a számlázási rendszerünktől külön e-mailben kapja.
                </p>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:1.65;color:${MUTED};">
                  A koncertre a jegykód mutatásával, nyomtatva vagy a telefonjáról is beléphet.
                </p>
                <p style="margin:14px 0 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
                  Réz körút &middot; <a href="https://rezkorut.hu" style="color:${MUTED};text-decoration:none;">rezkorut.hu</a>
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

/** QR data URLs per ticket (generated with qrcode.toDataURL, as in the brief). */
export async function ticketQrDataUrls(tickets: TicketEmailTicket[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const ticket of tickets) {
    urls.set(ticket.code, await QRCode.toDataURL(ticketUrl(ticket.code), { width: 240, margin: 1 }));
  }
  return urls;
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
    const qrUrls = await ticketQrDataUrls(data.tickets);
    const attachments = data.tickets.map((ticket) => {
      const dataUrl = qrUrls.get(ticket.code) ?? "";
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      return {
        filename: `jegy-${ticket.code}.png`,
        content: base64,
        encoding: "base64" as const,
        contentType: "image/png",
        cid: `qr-${ticket.code}@rezkorut`,
      };
    });

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
