/**
 * Server-only Europe/Budapest day-boundary math for ticket sales windows
 * (card 13). The dashboard sends calendar days (`YYYY-MM-DD`); the stored
 * `sales_start` / `sales_end` are those days' boundaries in Budapest wall
 * time — start of day 00:00:00, end of day 23:59:59 — so „eddig: november 20.”
 * keeps the whole closing day purchasable.
 *
 * Every comparison on the sell side runs against the STORED timestamps
 * (card 13 rule 7): the window is a pair of instants, and instants compare
 * without timezone math. This module is only needed where wall-clock days
 * become instants — the intern save route.
 */

/** Europe/Budapest offset (minutes) for a given instant, DST-safe. */
export function budapestOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    timeZoneName: "longOffset",
  });
  const part =
    fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const match = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 60;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Budapest wall-clock time of a calendar day → UTC milliseconds (DST-safe). */
function budapestLocalToMs(day: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Number.NaN;
  const guess = Date.parse(`${day}T${time}Z`);
  if (Number.isNaN(guess)) return Number.NaN;
  let offset = budapestOffsetMinutes(new Date(guess));
  let instant = guess - offset * 60_000;
  // The 00:00:00 / 23:59:59 boundaries never fall into the 01:00 UTC DST
  // jump, so one re-read of the offset settles it even on transition days.
  offset = budapestOffsetMinutes(new Date(instant));
  instant = guess - offset * 60_000;
  return instant;
}

/** `YYYY-MM-DD` → UTC instant of that day's 00:00:00 in Europe/Budapest. */
export function budapestDayStartMs(day: string): number {
  return budapestLocalToMs(day, "00:00:00");
}

/** `YYYY-MM-DD` → UTC instant of that day's 23:59:59 in Europe/Budapest. */
export function budapestDayEndMs(day: string): number {
  return budapestLocalToMs(day, "23:59:59");
}

/** Canonical ISO timestamp of the day's start (`2026-11-26T23:00:00.000Z`). */
export function budapestDayStartIso(day: string): string {
  return new Date(budapestDayStartMs(day)).toISOString();
}

/** Canonical ISO timestamp of the day's end (`2026-11-27T22:59:59.000Z`). */
export function budapestDayEndIso(day: string): string {
  return new Date(budapestDayEndMs(day)).toISOString();
}
