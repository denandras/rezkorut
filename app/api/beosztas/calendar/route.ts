import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

/*
 * Server-side relay to the calendar webhook that runs on the Hermes box.
 *
 * The browser never talks to the webhook directly: the URL and the shared secret
 * stay on the server (CALENDAR_WEBHOOK_URL / CALENDAR_WEBHOOK_SECRET in
 * .env.local), and the signature is computed here over the exact bytes we send,
 * so what the receiver verifies is what the client asked for.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Same cookie gate as every /intern page: without it anyone on the internet
  // could post rehearsals into the band calendar.
  if (req.cookies.get("rezkorut-intern-auth")?.value !== "1") {
    return NextResponse.json({ ok: false, error: "Bejelentkezés szükséges." }, { status: 401 });
  }

  const url = process.env.CALENDAR_WEBHOOK_URL;
  const secret = process.env.CALENDAR_WEBHOOK_SECRET;

  if (!url || !secret) {
    return NextResponse.json({ ok: false, error: "A naptár-küldés nincs beállítva ezen a szerveren." }, { status: 503 });
  }

  const body = await req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "Hibás kérés." }, { status: 400 });
  }

  const rehearsals = (parsed as { rehearsals?: unknown[] })?.rehearsals;
  if (!Array.isArray(rehearsals) || rehearsals.length === 0) {
    return NextResponse.json({ ok: false, error: "Nincs kijelölt próba." }, { status: 400 });
  }

  // The project name is required: it is the calendar title.
  if (!String((parsed as { title?: string })?.title ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "Add meg a projekt nevét." }, { status: 400 });
  }

  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": signature },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 500) };
    }
    return NextResponse.json(payload, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Nem értem el a naptár-szolgáltatást: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
