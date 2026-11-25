import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed confirmation tokens for free (0 Ft) orders (card 11).
 *
 * `POST /api/tickets/free` creates and fulfils the order synchronously —
 * there is no Stripe Checkout Session, so there is no session id to send the
 * buyer to `/jegyek/koszonjuk` with. Instead the endpoint returns a token that
 * names the order and proves the buyer was given it by us: the success page
 * verifies the signature and only then looks the order up (it must never
 * accept a bare order id — the card's own rule for the paid flow).
 *
 * Token shape: `<orderId>.<hmac-sha256 hex of orderId>` — the order id is a
 * uuid, so the token carries no buyer data at all.
 *
 * The key is `ORDER_TOKEN_SECRET` when set, falling back to
 * `STRIPE_TICKET_WEBHOOK_SECRET` (server-only, already configured in every
 * deployment of this app; a different purpose, but the same secret surface —
 * a server-only string nobody else can read). When no secret exists at all
 * the signer returns null and the route omits the token: `/jegyek/koszonjuk`
 * then renders its plain confirmation state, which is the card's allowed
 * alternative.
 *
 * Node type-stripping compatibility: no parameter properties, no enums
 * (the verification harness imports this file directly).
 */

function tokenSecret(): string | null {
  return process.env.ORDER_TOKEN_SECRET || process.env.STRIPE_TICKET_WEBHOOK_SECRET || null;
}

/** `orderId.hmacHex` — or null when no secret is configured. */
export function signOrderToken(orderId: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const mac = createHmac("sha256", secret).update(orderId).digest("hex");
  return `${orderId}.${mac}`;
}

/**
 * Verifies a token and returns the order id it names — or null for any
 * malformed, forged or too-long token. Constant-time on the digest.
 */
export function verifyOrderToken(token: string): string | null {
  if (!token || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const orderId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const secret = tokenSecret();
  if (!secret) return null;
  const expected = createHmac("sha256", secret).update(orderId).digest("hex");
  const given = Buffer.from(mac, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? orderId : null;
}
