/**
 * Availability schedule (/intern/probarend) — types + pure helpers.
 *
 * Data contract: public.sched_people / sched_marks / sched_locks (see
 * .brief-beosztas.md). A cell with no answer has NO row: "zero is data,
 * null is absence" — a count of 0 is "everyone answered no", absence of a
 * row is "nobody answered yet".
 */

export type { CellState, DayCounts } from "@/components/beosztas/state";
export { SLOT_TIMES as SLOTS, SLOT_TIMES } from "@/components/beosztas/state";
import { nextState as cycleNext, prevState as cyclePrev, SLOT_TIMES, type CellState } from "@/components/beosztas/state";

export type SchedState = "yes" | "maybe" | "no";

export interface SchedPerson {
  id: string;
  name: string;
  sort_order: number;
  visible: boolean;
  created_at: string;
}

export interface SchedMark {
  id: string;
  person_id: string;
  day: string; // YYYY-MM-DD
  slot: number; // 0 | 1 | 2
  state: SchedState;
  updated_at: string;
}

export interface SchedLock {
  key: string; // 'person:<uuid>'
  holder: string; // client id
  expires_at: string;
}

/** Click cycles yes → maybe → no → unanswered (delete row); Shift reverses. */
export function nextState(current: CellState): CellState {
  return cycleNext(current);
}

export function previousState(current: CellState): CellState {
  return cyclePrev(current);
}

/* ---------- dates (all local-time, no TZ drift) ---------- */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local Date → 'YYYY-MM-DD' (never use toISOString: it shifts by TZ). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → local Date at midnight. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export const WEEKDAYS_SHORT = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
export const WEEKDAYS_LONG = ["hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat", "vasárnap"];
export const MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Monday of the ISO week that contains d. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -weekdayIndex(d));
}

/** All dates of a month, chronological. */
export function monthDates(year: number, month: number): Date[] {
  const out: Date[] = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= last; i++) out.push(new Date(year, month, i));
  return out;
}

/** All dates in [from, to] inclusive; [] when from > to. */
export function datesInRange(fromISO: string, toISO: string): Date[] {
  const out: Date[] = [];
  let cur = fromISODate(fromISO);
  const end = fromISODate(toISO);
  if (cur > end) return out;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function markKey(personId: string, day: string, slot: number): string {
  return `${personId}|${day}|${slot}`;
}

export function isWeekend(d: Date): boolean {
  const wd = weekdayIndex(d);
  return wd >= 5;
}

/*
 * A–Z ordering for every place a person's name appears (picker, people modal,
 * availability lists, CSV). Hungarian collation via localeCompare('hu') so
 * á/é/í/ó/ö/ő/ú/ü/ű sort where a Hungarian reader expects them, not by code point.
 * `sort_order` from the database is the fallback only for identical names.
 */
export function sortPeopleByName<T extends { name: string; sort_order?: number }>(people: T[]): T[] {
  return [...people].sort(
    (a, b) => a.name.localeCompare(b.name, "hu", { sensitivity: "base" }) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
}

export function sortNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, "hu", { sensitivity: "base" }));
}

/* ---------- soft lock helpers ---------- */

export const LOCK_KEY_PREFIX = "person:";
export const LOCK_TTL_MS = 90_000;
export const LOCK_RENEW_MS = 30_000;

export function makeClientId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `c-${rnd.slice(0, 6)}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** A lock is meaningful only while it is in the future. */
export function isLockActive(lock: SchedLock | undefined, nowMs: number = Date.now()): boolean {
  if (!lock) return false;
  const t = Date.parse(lock.expires_at);
  return Number.isFinite(t) && t > nowMs;
}

/* ---------- ISO week + labels ---------- */

/** ISO-8601 week number of the Monday-based week containing d. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

/** Short date label: "nov. 8." */
export function shortDateLabel(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)}. ${d.getDate()}.`;
}

/** Long date label: "2026. november 8." */
export function longDateLabel(d: Date): string {
  return `${d.getFullYear()}. ${MONTHS[d.getMonth()]} ${d.getDate()}.`;
}

/** Weeks (Mon–Sun) of a month, padded to full weeks with nulls for out-of-month days. */
export function monthWeeks(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const weeks: (Date | null)[][] = [];
  let cur = startOfWeek(first);
  while (cur <= last) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(cur, i);
        return d.getMonth() === month ? d : null;
      })
    );
    cur = addDays(cur, 7);
  }
  return weeks;
}

/* ---------- CSV ---------- */

/** Quote a CSV field when it contains the separator, a quote, or a newline. */
function csvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface CsvOptions {
  people: SchedPerson[]; // visible people, in display order
  marks: Map<string, CellState>;
  fromISO: string;
  toISO: string;
}

/**
 * Build the export. Format per brief:
 *   UTF-8 WITH BOM, ';' separator, CRLF.
 * Header: date;weekday;slot;time;<person...> then a totals block.
 */
export function buildCsv(opts: CsvOptions): string {
  const { people, marks, fromISO, toISO } = opts;
  const SEP = ";";
  const EOL = "\r\n";
  const rows: string[][] = [];

  rows.push([
    "dátum",
    "nap",
    "sáv",
    "időpont",
    ...people.map((p) => p.name),
  ]);

  const dates = datesInRange(fromISO, toISO);
  const totals: Record<string, { yes: number; maybe: number; no: number }> = {};
  for (const p of people) totals[p.id] = { yes: 0, maybe: 0, no: 0 };

  for (const d of dates) {
    const day = toISODate(d);
    const weekday = WEEKDAYS_LONG[weekdayIndex(d)];
    for (const s of SLOT_TIMES) {
      const row = [day, weekday, String(s.id + 1), s.label];
      for (const p of people) {
        const st = marks.get(markKey(p.id, day, s.id));
        if (st) totals[p.id][st] += 1;
        row.push(st ?? "");
      }
      rows.push(row);
    }
  }

  // Blank spacer, then per-person totals block.
  rows.push([]);
  rows.push(["összesítő", "ráér", "talán", "nem ér rá"]);
  for (const p of people) {
    const t = totals[p.id];
    rows.push([p.name, String(t.yes), String(t.maybe), String(t.no)]);
  }

  const body = rows.map((r) => r.map(csvField).join(SEP)).join(EOL) + EOL;
  return "\uFEFF" + body;
}
