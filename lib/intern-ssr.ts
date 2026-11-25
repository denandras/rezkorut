import { cookies, headers } from "next/headers";

/**
 * Server-side helpers for the intern pages that render data into the HTML
 * (/intern, /intern/koncertek). The pages stay cookie-gated exactly like the
 * older client pages — the same `rezkorut-intern-auth=1` cookie — but the
 * authed view is server-rendered so the dashboard is in the response HTML.
 */

const INTERN_COOKIE = "rezkorut-intern-auth";

/** True when the incoming request carries the intern cookie. */
export async function hasInternCookie(): Promise<boolean> {
  return (await cookies()).get(INTERN_COOKIE)?.value === "1";
}

/**
 * Fetches an /api/intern/* route of this app during server rendering,
 * forwarding the incoming request's cookies — so every dashboard read goes
 * through the card 02 API, the same endpoint the client refreshes use.
 *
 * Returns null when the intern cookie is missing, the origin cannot be
 * derived, the route answers non-200, or the body is not JSON. Callers render
 * their unauthenticated or empty state for null.
 */
export async function fetchInternApi<T>(path: string): Promise<T | null> {
  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  if (!cookie.split(";").some((part) => part.trim() === `${INTERN_COOKIE}=1`)) {
    return null;
  }
  const host = h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ??
    (/^(localhost|127\.0\.0\.1|\[)/.test(host) ? "http" : "https");
  try {
    const res = await fetch(`${proto}://${host}${path}`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[intern-ssr] ${path} fetch failed:`, err);
    return null;
  }
}
