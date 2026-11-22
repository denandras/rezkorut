"use client";

/*
 * Availability engine for the "Load" section.
 *
 * Answers one question: within a range, which DATE + TIME SLOT actually works for
 * at least N people? This is the ensemble-facing question ("when can we rehearse
 * with 6 of 8?"), the inverse of the marking grid ("when is Sándor free?").
 *
 * Rules (deliberate, stated in the UI too):
 * - A "yes" counts. A "maybe" does NOT count toward the minimum — otherwise a
 *   "talán" silently becomes a commitment. Maybes are shown as slack, so a slot
 *   with 5 yes + 2 maybe is visibly one short but rescue-able.
 * - Unanswered is absence, never a no: it is reported separately and never summed
 *   into "nem ér rá".
 * - Only VISIBLE people are counted; hiding someone removes them from the maths.
 */

import { SLOT_TIMES, type CellState, type SlotTime } from "@/components/beosztas/state";
import { markKey, weekdayIndex, WEEKDAYS_LONG, fromISODate, toISODate, type SchedPerson } from "@/lib/beosztas";

export interface SlotLoad {
  day: string; // YYYY-MM-DD
  slot: 0 | 1 | 2;
  yes: string[]; // names
  maybe: string[]; // names
  no: string[];
  none: string[]; // unanswered
}

export interface DayLoad {
  day: string;
  weekday: string;
  slots: SlotLoad[];
  /** Best slot of the day = most yes. */
  best: SlotLoad | null;
  /** Whole-day score: the slot with the fewest conflicts (most yes). */
  bestYes: number;
}

/** Score every day/slot in [days] for the given people. */
export function scoreRange(
  days: string[],
  people: SchedPerson[],
  marks: Map<string, CellState>,
  slotTimes: SlotTime[] = SLOT_TIMES
): DayLoad[] {
  return days.map((day) => {
    const slots: SlotLoad[] = slotTimes.map((s) => {
      const out: SlotLoad = { day, slot: s.id, yes: [], maybe: [], no: [], none: [] };
      for (const p of people) {
        const st = marks.get(markKey(p.id, day, s.id)) ?? null;
        if (st === "yes") out.yes.push(p.name);
        else if (st === "maybe") out.maybe.push(p.name);
        else if (st === "no") out.no.push(p.name);
        else out.none.push(p.name);
      }
      return out;
    });
    let best: SlotLoad | null = null;
    for (const s of slots) if (!best || s.yes.length > best.yes.length) best = s;
    // NEVER `new Date("YYYY-MM-DD")` — that is UTC midnight and in Budapest it is
    // the PREVIOUS day, which shifts every weekday label by one.
    const d = fromISODate(day);
    return {
      day,
      weekday: WEEKDAYS_LONG[weekdayIndex(d)],
      slots,
      best,
      bestYes: best ? best.yes.length : 0,
    };
  });
}

/** Rows that clear the minimum (yes >= min), strongest first, then by date. */
export function qualifyingSlots(daysLoad: DayLoad[], min: number): SlotLoad[] {
  const rows: SlotLoad[] = [];
  for (const d of daysLoad) for (const s of d.slots) if (s.yes.length >= min) rows.push(s);
  return rows.sort((a, b) => b.yes.length - a.yes.length || a.day.localeCompare(b.day) || a.slot - b.slot);
}

export interface LoadSummary {
  totalSlots: number;
  qualifying: number;
  daysWithAnyQualifying: number;
  maxYes: number;
}

export function summarize(daysLoad: DayLoad[], min: number): LoadSummary {
  const q = qualifyingSlots(daysLoad, min);
  const days = new Set(q.map((r) => r.day));
  let maxYes = 0;
  for (const d of daysLoad) for (const s of d.slots) maxYes = Math.max(maxYes, s.yes.length);
  return { totalSlots: daysLoad.length * SLOT_TIMES.length, qualifying: q.length, daysWithAnyQualifying: days.size, maxYes };
}

/** Days where ALL THREE slots are impossible for >= min people — worth seeing as dead. */
export function deadDays(daysLoad: DayLoad[], min: number): string[] {
  return daysLoad.filter((d) => d.slots.every((s) => s.yes.length < min)).map((d) => d.day);
}

export function isoDaysBetween(days: Date[]): string[] {
  return days.map((d) => toISODate(d));
}
