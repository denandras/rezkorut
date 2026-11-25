/**
 * Deterministic Hungarian date formatting shared by the dashboard and the buy
 * flow (card 13). Pure functions only — no server imports, no clock reads: the
 * server render and the client hydration must produce the very same strings.
 *
 * The month tables are hand-written (never a locale-dependent formatter), so
 * „nov. 20-ig” and „november 20-ig” are identical on every machine. The one
 * Intl-based helper, `budapestDayOf`, follows the repo's established sv-SE
 * pattern (components/koncertek/types.ts `formatTimestampHu`,
 * lib/ticket-db.ts `todayIsoInBudapest`).
 */

const HU_MONTH_NAMES = [
  "január",
  "február",
  "március",
  "áprilus",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

const HU_MONTH_ABBREVS = [
  "jan.",
  "febr.",
  "márc.",
  "ápr.",
  "máj.",
  "jún.",
  "júl.",
  "aug.",
  "szept.",
  "okt.",
  "nov.",
  "dec.",
] as const;

export type HuDay = { year: number; month: number; day: number };

/** Parses a sortable calendar day (`2026-11-27`); null for anything else. */
export function parseIsoDay(value: string | null | undefined): HuDay | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Real calendar day (rejects 2026-02-30): the components must survive a
  // Date round-trip.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** ISO timestamp → `YYYY-MM-DD` in Europe/Budapest; null for unparseable input. */
export function budapestDayOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(
    new Date(millis),
  );
}

/**
 * Day numbers whose Hungarian pronunciation ends in a back vowel (három, hat,
 * nyolc, tizenhárom, tizenhat, tizennyolc, husz, huszonhárom, huszonhat,
 * huszonnyolc) take „-tól”; every other day of the month takes „-től”.
 */
const TOL_DAYS = new Set([3, 6, 8, 13, 16, 18, 20, 23, 26, 28]);

/** „november 20-ig” — the -ig suffix fits every day number unchanged. */
export function huUntil(value: string | null | undefined): string | null {
  const day = parseIsoDay(value);
  if (!day) return null;
  return `${HU_MONTH_NAMES[day.month - 1]} ${day.day}-ig`;
}

/** „november 10-től”. */
export function huFrom(value: string | null | undefined): string | null {
  const day = parseIsoDay(value);
  if (!day) return null;
  return `${HU_MONTH_NAMES[day.month - 1]} ${day.day}-${TOL_DAYS.has(day.day) ? "tól" : "től"}`;
}

/** `nov. 10.` — the dashboard's abbreviated day (`2026. nov. 10.` with the year). */
function abbrevDay(day: HuDay, withYear: boolean): string {
  const core = `${HU_MONTH_ABBREVS[day.month - 1]} ${day.day}.`;
  return withYear ? `${day.year}. ${core}` : core;
}

/**
 * The dashboard's early-bird window summary (card 13): `nov. 10. – nov. 20.`
 * (both ends set) · `nov. 20-ig` (only the end) · `nov. 10-től` (only the
 * start) · `folyamatos` (neither). A cross-year range carries the year on
 * both sides. Malformed values count as unset.
 */
export function earlyBirdWindowSummary(start: string | null, end: string | null): string {
  const startDay = parseIsoDay(start);
  const endDay = parseIsoDay(end);
  if (startDay && endDay) {
    const withYear = startDay.year !== endDay.year;
    return `${abbrevDay(startDay, withYear)} – ${abbrevDay(endDay, withYear)}`;
  }
  if (endDay) {
    return `${HU_MONTH_ABBREVS[endDay.month - 1]} ${endDay.day}-ig`;
  }
  if (startDay) {
    return `${HU_MONTH_ABBREVS[startDay.month - 1]} ${startDay.day}-${
      TOL_DAYS.has(startDay.day) ? "tól" : "től"
    }`;
  }
  return "folyamatos";
}
