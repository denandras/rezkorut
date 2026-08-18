/**
 * Shared intern auth helpers.
 *
 * Uses a cookie that expires at the end of the current calendar year
 * (Dec 31 23:59:59 UTC) so the password stays for at least a month
 * and resets annually.
 */

const COOKIE_NAME = "rezkorut-intern-auth";

export const INTERN_PASSWORD = process.env.NEXT_PUBLIC_INTERN_PASSWORD ?? "";

function yearEndExpiry(): string {
  const now = new Date();
  return new Date(now.getFullYear(), 11, 31, 23, 59, 59).toUTCString();
}

export function getInternAuth(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${COOKIE_NAME}=1`);
}

export function setInternAuth(): void {
  document.cookie = `${COOKIE_NAME}=1; expires=${yearEndExpiry()}; path=/; SameSite=Lax`;
}