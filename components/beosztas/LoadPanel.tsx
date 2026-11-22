"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCalendar, IconCheck, IconClose, IconDownload } from "@/components/icons";
import Modal from "@/components/beosztas/Modal";
import { STATE_META, type CellState, type SlotTime } from "@/components/beosztas/state";
import { qualifyingSlots, scoreRange, summarize, type DayLoad, type SlotLoad } from "@/components/beosztas/availability";
import { MONTHS, WEEKDAYS_LONG, datesInRange, fromISODate, monthDates, toISODate, weekdayIndex, type SchedPerson } from "@/lib/beosztas";

/*
 * Load sheet — "when can we actually rehearse?"
 *
 * Pick a minimum number of people, pick a period, get the real dates + slots
 * that clear it, strongest first.
 *
 * Period: the remainder of the chosen month (default — past days cannot be
 * rehearsed), the whole chosen month, or "while filled" (from today until the
 * furthest day anyone has actually marked). There is no year view: it answered
 * a question nobody asked and made the list unreadable.
 *
 * Counting rule: a "ráérek" counts toward the minimum, a "talán" does NOT — it
 * is carried as slack and shown as a yellow number in front of the green one
 * (e.g. 1+7 = one maybe, seven yes).
 */

type Range = "rest" | "month" | "filled";

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** CSV of the load result, same Excel-safe encoding as the main export. */
function buildLoadCsv(rows: SlotLoad[], people: SchedPerson[], min: number, fromISO: string, toISO2: string, slots: SlotTime[]): string {
  const SEP = ";";
  const EOL = "\r\n";
  const field = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[][] = [];
  lines.push([`Lehetséges próbák (min. ${min} fő), ${fromISO} – ${toISO2}`]);
  lines.push([]);
  lines.push(["dátum", "nap", "időpont", "ráér (fő)", "ráér", "talán (fő)", "talán", "nem ér rá (fő)", "nincs jelölve (fő)"]);
  for (const r of rows) {
    const s = slots[r.slot];
    lines.push([
      r.day,
      WEEKDAYS_LONG[weekdayIndex(fromISODate(r.day))],
      s.label,
      String(r.yes.length),
      r.yes.join(", "),
      String(r.maybe.length),
      r.maybe.join(", "),
      String(r.no.length),
      String(r.none.length),
    ]);
  }
  return "\uFEFF" + lines.map((l) => l.map(field).join(SEP)).join(EOL) + EOL;
}

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LoadPanel({
  open,
  onClose,
  people,
  marks,
  slots,
  year,
  month,
}: {
  open: boolean;
  onClose: () => void;
  people: SchedPerson[]; // visible people only
  marks: Map<string, CellState>;
  slots: SlotTime[];
  year: number;
  month: number; // 0..11
}) {
  const [range, setRange] = useState<Range>("rest");
  const [min, setMin] = useState<number>(5);
  // Every qualifying rehearsal starts CHECKED (owner's rule); the set holds the
  // ones the user unticked, so changing the threshold keeps their choices.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  // Project name rides into the calendar title: "Réz krt <title> -Name…"
  // Required, and deliberately NOT persisted: every page load starts blank so a
  // stale project name can never leak into the next set of events.
  const [project, setProject] = useState("");
  const projectOk = project.trim().length > 0;
  useEffect(() => {
    try {
      window.localStorage.removeItem("beosztas_project");
    } catch {
      /* ignore */
    }
  }, []);
  const eventTitle = projectOk ? `Réz krt ${project.trim()}` : "Réz krt";
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  // The sheet keeps its own month cursor so browsing April here does not move
  // the marking grid behind it.
  const [cursor, setCursor] = useState<{ year: number; month: number }>({ year, month });

  const total = people.length;
  // Presets run from 2 up to the number of people CURRENTLY SHOWN in the chart,
  // gapless: with 9 shown that is 2/3/4/5/6/7/8/9. Two is the floor because one
  // person agreeing is not a rehearsal; the top can never ask for more people
  // than the chart contains. A lone person degrades to 1.
  const lo = total >= 2 ? 2 : Math.max(1, total);
  const presets = useMemo(
    () => (total === 0 ? [] : Array.from({ length: total - lo + 1 }, (_, i) => lo + i)),
    [total, lo],
  );

  // Keep the minimum inside the band WITHOUT writing state on mount: a plain
  // useEffect here reset `min` to 1 (the first paint clamps against a total of
  // 0 before people load), which matched every slot. Derive it instead.
  const effectiveMin = Math.min(Math.max(lo, min), Math.max(lo, total));

  const monthDays = useMemo(() => monthDates(cursor.year, cursor.month).map(toISODate), [cursor]);
  const todayISO = toISODate(new Date());

  /** Furthest day anyone has marked — the end of "while filled". */
  const lastMarkedISO = useMemo(() => {
    let max = "";
    for (const k of marks.keys()) {
      const day = k.split("|")[1];
      if (day && day > max) max = day;
    }
    return max;
  }, [marks]);

  const [days, fromISO, toISO2] = useMemo(() => {
    if (range === "month") {
      return [monthDays, monthDays[0], monthDays[monthDays.length - 1]] as const;
    }
    if (range === "filled") {
      const end = lastMarkedISO || monthDays[monthDays.length - 1];
      const start = todayISO;
      if (end < start) return [[] as string[], start, start] as const;
      const all = datesInRange(start, end).map(toISODate);
      return [all, all[0], all[all.length - 1]] as const;
    }
    // "rest" — remainder of the chosen month, today onwards
    const rest = monthDays.filter((d) => d >= todayISO);
    const span = rest.length ? rest : monthDays;
    return [span, span[0], span[span.length - 1]] as const;
  }, [range, monthDays, todayISO, lastMarkedISO]);

  const daysLoad: DayLoad[] = useMemo(() => scoreRange(days, people, marks, slots), [days, people, marks, slots]);
  const rows = useMemo(() => qualifyingSlots(daysLoad, effectiveMin), [daysLoad, effectiveMin]);
  const summary = useMemo(() => summarize(daysLoad, effectiveMin), [daysLoad, effectiveMin]);

  const keyOf = (r: SlotLoad) => `${r.day}|${r.slot}`;
  const selected = useMemo(() => rows.filter((r) => !excluded.has(keyOf(r))), [rows, excluded]);

  // A send-result line is only about the last action; drop it when the inputs move.
  useEffect(() => {
    setSendResult(null);
    setSendFailed(false);
  }, [range, effectiveMin, cursor, excluded]);

  // group the qualifying rows by day for display
  const grouped = useMemo(() => {
    const map = new Map<string, SlotLoad[]>();
    for (const r of rows) {
      const list = map.get(r.day) ?? [];
      list.push(r);
      map.set(r.day, list);
    }
    return [...map.entries()];
  }, [rows]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 0) return { year: c.year - 1, month: 11 };
      if (m > 11) return { year: c.year + 1, month: 0 };
      return { year: c.year, month: m };
    });
  }

  async function sendToCalendar() {
    setSending(true);
    setSendResult(null);
    try {
      const payload = {
        title: project.trim(),
        range: { from: fromISO, to: toISO2 },
        min: effectiveMin,
        rehearsals: selected
          .slice()
          .sort((a, b) => a.day.localeCompare(b.day) || a.slot - b.slot)
          .map((r) => ({
            day: r.day,
            slot: r.slot,
            start: slots[r.slot].start,
            end: slots[r.slot].end,
            yes: r.yes,
            maybe: r.maybe,
            no: r.no,
          })),
      };
      const res = await fetch("/api/beosztas/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        created?: string[];
        skipped?: string[];
        failed?: unknown[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setSendFailed(true);
        setSendResult(data.error ?? "Nem sikerült elküldeni a naptárba.");
      } else {
        const created = data.created?.length ?? 0;
        const skipped = data.skipped?.length ?? 0;
        const failed = data.failed?.length ?? 0;
        setSendFailed(failed > 0);
        setSendResult(
          `${created} időpont a naptárban` +
            (skipped ? `, ${skipped} már ott volt` : "") +
            (failed ? `, ${failed} nem sikerült` : "") +
            "."
        );
      }
      setConfirmSend(false);
    } catch (e) {
      setSendFailed(true);
      setSendResult(`Hiba: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const tooFewAnswered = summary.maxYes === 0;

  return (
    <Modal open={open} onClose={onClose} labelledBy="load-title">
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-neutral-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id="load-title" className="font-display text-[17px] font-semibold text-neutral-100">
            Lehetséges próbák
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Bezárás"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-border text-ink-muted transition-colors hover:text-neutral-100"
        >
          <IconClose className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {/* project name comes FIRST: it is what the whole panel is for */}
        <div>
          <label
            htmlFor="project-title"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint"
          >
            Projekt neve
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-[13.5px] text-ink-muted">Réz krt</span>
            <input
              id="project-title"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="BMC"
              className="h-10 w-full min-w-0 rounded-lg border border-neutral-border bg-[#0b1a10] px-3 text-[14px] text-neutral-100 outline-none transition-colors placeholder:text-ink-faint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <p className="mt-1.5 text-[11.5px]">
            {projectOk ? (
              <span className="text-ink-faint">
                A naptárban: <span className="text-ink-muted">{eventTitle}</span> + a hiányzók neve
              </span>
            ) : selected.length > 0 ? (
              <span className="text-[#ed9a91]">A naptárba küldéshez add meg a projekt nevét.</span>
            ) : (
              <span className="text-ink-faint">A naptárban: Réz krt + a projekt neve</span>
            )}
          </p>
        </div>

        {/* minimum people */}
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Minimum létszám</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {presets.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={effectiveMin === n}
              onClick={() => setMin(n)}
              className={`h-11 min-w-11 rounded-full border px-3.5 text-[13.5px] font-semibold tabular-nums transition-colors ${
                effectiveMin === n
                  ? "border-primary/60 bg-primary/[0.14] text-primary"
                  : "border-neutral-border bg-[#14281c] text-ink-muted hover:border-[#2a4a36] hover:text-neutral-100"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* period */}
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Időszak</p>
        <div role="tablist" aria-label="Időszak" className="mt-2 flex gap-1.5 overflow-x-auto">
          {(
            [
              ["rest", "Hátralévő"],
              ["month", "Egész hónap"],
              ["filled", "Amíg kitöltve"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={range === v}
              onClick={() => setRange(v)}
              className={`h-10 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
                range === v
                  ? "border-primary/60 bg-primary/[0.14] text-primary"
                  : "border-neutral-border text-ink-muted hover:text-neutral-100"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* month cursor — hidden for "while filled", which spans months by design */}
        {range !== "filled" && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Előző hónap"
              onClick={() => shiftMonth(-1)}
              className="flex size-10 items-center justify-center rounded-full border border-neutral-border text-ink-muted transition-colors hover:text-primary"
            >
              ‹
            </button>
            <span className="min-w-[132px] text-center text-[13px] font-semibold tabular-nums text-neutral-100">
              {cursor.year}. {MONTHS[cursor.month]}
            </span>
            <button
              type="button"
              aria-label="Következő hónap"
              onClick={() => shiftMonth(1)}
              className="flex size-10 items-center justify-center rounded-full border border-neutral-border text-ink-muted transition-colors hover:text-primary"
            >
              ›
            </button>
          </div>
        )}

        {/* summary: number + bar, never a lone big number */}
        <div className="mt-5 rounded-2xl border border-neutral-border bg-[#14281c]/60 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13.5px] font-semibold text-neutral-100">
              {summary.qualifying === 0 ? "Nincs megfelelő időpont" : `${summary.qualifying} időpont megfelel`}
            </p>
            <p className="text-[12.5px] tabular-nums text-ink-muted">
              {summary.daysWithAnyQualifying} napon · max {summary.maxYes}/{total} fő
            </p>
          </div>
          <span className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#0b1a10]" aria-hidden="true">
            <span
              className="h-full rounded-full"
              style={{
                width: `${summary.totalSlots ? Math.min(100, (summary.qualifying / summary.totalSlots) * 100) : 0}%`,
                backgroundColor: STATE_META.yes.hex,
                opacity: 0.8,
              }}
            />
          </span>
        </div>

        {/* results */}
        {tooFewAnswered ? (
          <div className="mt-4 rounded-2xl border border-neutral-border bg-neutral-dark px-4 py-6 text-center">
            <p className="text-[13.5px] font-medium text-neutral-100">Még senki nem jelölt ebben az időszakban.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-neutral-border bg-neutral-dark px-4 py-6 text-center">
            <p className="text-[13.5px] font-medium text-neutral-100">
              Egy időpont sem éri el a {effectiveMin} főt{summary.maxYes > 0 ? ` — a legjobb ${summary.maxYes} fő` : ""}.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {grouped.map(([day, slotsInDay]) => {
              const d = fromISODate(day);
              const weekend = weekdayIndex(d) >= 5;
              return (
                <div
                  key={day}
                  className={`rounded-2xl border border-neutral-border p-3 ${
                    weekend ? "bg-[#f3e7c9]/[0.10]" : "bg-neutral-dark/60"
                  }`}
                >
                  <p className="text-[13px] font-semibold tabular-nums text-neutral-100">
                    {d.getFullYear()}. {d.getMonth() + 1}. {d.getDate()}.{" "}
                    <span className="font-normal text-ink-faint">{WEEKDAYS_LONG[weekdayIndex(d)]}</span>
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {slotsInDay.map((r) => (
                      <SlotRow
                        key={r.slot}
                        row={r}
                        slots={slots}
                        checked={!excluded.has(`${r.day}|${r.slot}`)}
                        onToggle={() =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            const k = `${r.day}|${r.slot}`;
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* footer — sending to the calendar is the primary action, CSV is secondary */}
      <div className="px-4 py-3 sm:px-5">
        {confirmSend ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-snug text-neutral-100">
              {selected.length} időpont bekerül a rezkorut naptárba „{eventTitle}” néven. Küldhetem?
            </p>
            {/* right-aligned: Mégse on the left, Igen on the right */}
            <div className="flex shrink-0 justify-end gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => setConfirmSend(false)}
                className="h-11 rounded-full border border-neutral-border px-4 text-[13px] font-medium text-ink-muted hover:text-neutral-100"
              >
                Mégse
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendToCalendar()}
                className="h-11 rounded-full bg-primary px-4 text-[13px] font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Küldés…" : "Küldés"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => download(`proba-lehetosegek-${fromISO}-${toISO2}.csv`, buildLoadCsv(selected, people, effectiveMin, fromISO, toISO2, slots))}
              className="order-2 inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-neutral-border px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-primary disabled:opacity-40 sm:order-1"
            >
              <IconDownload className="size-4" />
              CSV letöltése ({selected.length})
            </button>
            <button
              type="button"
              disabled={selected.length === 0 || !projectOk}
              onClick={() => setConfirmSend(true)}
              className="order-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 disabled:opacity-40 sm:order-2"
            >
              <IconCalendar className="size-4" />
              Naptárba ({selected.length})
            </button>
          </div>
        )}

        {sendResult ? (
          <p className={`mt-2 text-[12.5px] ${sendFailed ? "text-[#ed9a91]" : "text-ink-muted"}`}>{sendResult}</p>
        ) : null}
      </div>
    </Modal>
  );
}

/*
 * One slot line: checkbox, time, the actual names, then the tally right-aligned
 * and vertically centred so a column of numbers reads at a glance (7, 6, 5…).
 *
 * Every line starts CHECKED; unticking it dims the row and drops it from both
 * the calendar send and the CSV. Names carry their own marker — `Matyi?` is
 * unsure, `-Dusi` cannot come — instead of separate "N nem ér rá" counters.
 * The tally is `maybe+yes` (yellow + green), e.g. 1+7.
 */
function SlotRow({
  row,
  slots,
  checked,
  onToggle,
}: {
  row: SlotLoad;
  slots: SlotTime[];
  checked: boolean;
  onToggle: () => void;
}) {
  const yes = row.yes;
  const maybe = row.maybe;
  const no = row.no;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl bg-[#14281c] px-2.5 py-2.5 transition-opacity ${
        checked ? "opacity-100" : "opacity-40"
      }`}
    >
      {/* 44px touch target on phones; the visual box stays small */}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${SLOT_LABEL(slots, row.slot)} kijelölése`}
        onClick={onToggle}
        className="-my-2 flex size-11 shrink-0 items-center justify-center sm:my-0 sm:size-7"
      >
        <span
          className={`flex size-6 items-center justify-center rounded-md border transition-colors sm:size-5 ${
            checked ? "border-primary bg-primary text-[#0b1a10]" : "border-neutral-border text-transparent"
          }`}
        >
          <IconCheck className="size-3.5" />
        </span>
      </button>

      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-neutral-100">{slots[row.slot]?.label}</span>

      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-muted">
        <span className="text-[#cfd8d2]">{yes.join(", ")}</span>
        {maybe.length > 0 && (
          <span className="text-[#e6be5f]">
            {yes.length > 0 ? " " : ""}
            {maybe.map((n) => `${n}?`).join(" ")}
          </span>
        )}
        {no.length > 0 && (
          <span className="text-[#ed9a91]">
            {yes.length + maybe.length > 0 ? " " : ""}
            {no.map((n) => `-${n}`).join(" ")}
          </span>
        )}
      </p>

      <span
        className="flex shrink-0 items-center justify-end gap-0.5 self-center text-[17px] font-bold tabular-nums"
        aria-label={
          `${yes.length} ráér` +
          (maybe.length ? `, ${maybe.length} talán` : "") +
          (no.length ? `, ${no.length} nem ér rá` : "") +
          (row.none.length ? `, ${row.none.length} nincs jelölve` : "")
        }
      >
        {maybe.length > 0 && (
          <>
            <span className="text-[#e6be5f]">{maybe.length}</span>
            <span className="text-[13px] font-normal text-ink-faint">+</span>
          </>
        )}
        <span className="text-[#86e3a0]">{yes.length}</span>
      </span>
    </div>
  );
}

function SLOT_LABEL(slots: SlotTime[], id: number): string {
  return slots[id]?.label ?? "";
}
