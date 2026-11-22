/**
 * Schedule state system — single source of truth for the four cell states.
 * (Design spec §1: colours, labels, glyph names, cycle order.)
 *
 * Zero is data, null is absence: `null` here means "no row in sched_marks",
 * i.e. nobody answered — never the same thing as "no".
 */

export type CellState = "yes" | "maybe" | "no" | null;

export type StateGlyph = "check" | "question" | "cross" | null;

export const STATE_META: Record<"yes" | "maybe" | "no" | "none", { label: string; short: string; hex: string; glyph: StateGlyph }> = {
  yes: { label: "Ráérek", short: "igen", hex: "#86e3a0", glyph: "check" },
  maybe: { label: "Ha kell, ott vagyok", short: "talán", hex: "#e6be5f", glyph: "question" },
  no: { label: "Nem érek rá", short: "nem", hex: "#ed9a91", glyph: "cross" },
  none: { label: "Nincs jelölve", short: "üres", hex: "#94a29a", glyph: null },
};

export function metaOf(state: CellState) {
  return STATE_META[state ?? "none"];
}

/** Click / Enter / Space advances one step: yes → maybe → no → unanswered → yes. */
export const STATE_CYCLE: CellState[] = ["yes", "maybe", "no", null];

export function nextState(state: CellState): CellState {
  const i = STATE_CYCLE.indexOf(state);
  return STATE_CYCLE[(i + 1) % STATE_CYCLE.length];
}

export function prevState(state: CellState): CellState {
  const i = STATE_CYCLE.indexOf(state);
  return STATE_CYCLE[(i - 1 + STATE_CYCLE.length) % STATE_CYCLE.length];
}

/** aria-checked mapping: yes/maybe true, no/unanswered false (§5.2). */
export function ariaChecked(state: CellState): "true" | "false" {
  return state === "yes" || state === "maybe" ? "true" : "false";
}

/* ---------- shared colour recipes (§1 table, §4.1) ---------- */

export const STATE_CELL_CLASSES: Record<"yes" | "maybe" | "no" | "none", string> = {
  yes: "border-[#86e3a0]/30 bg-[#86e3a0]/[0.14] text-[#86e3a0] hover:bg-[#86e3a0]/[0.20]",
  maybe: "border-[#e6be5f]/30 bg-[#e6be5f]/[0.14] text-[#e6be5f] hover:bg-[#e6be5f]/[0.20]",
  no: "border-[#ed9a91]/30 bg-[#ed9a91]/[0.14] text-[#ed9a91] hover:bg-[#ed9a91]/[0.20]",
  none: "border-neutral-border bg-[#14281c] text-[#7d8b82] hover:border-[#2a4a36] hover:bg-[#172c1f]",
};

export function stateCellClasses(state: CellState): string {
  return STATE_CELL_CLASSES[state ?? "none"];
}

/* ---------- slot times ---------- */

/*
 * Slot times are a GLOBAL setting, stored in `sched_slots` and shared by every
 * visitor (owner's requirement): if one member edits 09:00–12:00 to 10:00–13:00,
 * everybody sees that. DEFAULT_SLOT_TIMES is only the fallback for the first
 * paint / SSR, before the row arrives.
 */
export interface SlotTime {
  id: 0 | 1 | 2;
  start: string; // 'HH:MM'
  end: string;
  label: string; // '09:00–12:00' (en dash)
  short: string; // '09–12'
}

export const DEFAULT_SLOT_TIMES: { id: 0 | 1 | 2; start: string; end: string }[] = [
  { id: 0, start: "09:00", end: "12:00" },
  { id: 1, start: "13:00", end: "16:00" },
  { id: 2, start: "17:00", end: "20:00" },
];

export function makeSlot(id: 0 | 1 | 2, start: string, end: string): SlotTime {
  return { id, start, end, label: `${start}–${end}`, short: `${start.slice(0, 2)}–${end.slice(0, 2)}` };
}

export const SLOT_TIMES: SlotTime[] = DEFAULT_SLOT_TIMES.map((s) => makeSlot(s.id, s.start, s.end));

/** 'HH:MM' or null when the string is not a real time. */
export function parseTime(v: string): { h: number; m: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function minutesOf(v: string): number | null {
  const t = parseTime(v);
  return t ? t.h * 60 + t.m : null;
}

/** Returns an error message, or null when the pair is valid. */
export function validateSlot(start: string, end: string): string | null {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === null || b === null) return "Az időpont formátuma ÓÓ:PP legyen (pl. 09:30).";
  if (a >= b) return "A kezdés legyen korábban, mint a befejezés.";
  if (b - a < 30) return "A próba legalább 30 perc legyen.";
  return null;
}

/* ---------- day summary (bar segments + caption) ---------- */

export interface DayCounts {
  yes: number;
  maybe: number;
  no: number;
  none: number;
}

export function dayCaption(c: DayCounts): string {
  return `${c.yes} IGEN · ${c.maybe} TALÁN · ${c.no} NEM · ${c.none} ÜRES`;
}

export function daySentence(c: DayCounts, total: number): string {
  const answered = total - c.none;
  if (total === 0) return "Nincs látható tag erre a napra.";
  if (answered === 0) return `A ${total} tagnak még nincs jelölése erre a napra.`;
  return `${total}-ból ${c.yes}-en ráérnek${c.maybe ? `, ${c.maybe} talán` : ""}${c.no ? `, ${c.no} nem ér rá` : ""}.`;
}
