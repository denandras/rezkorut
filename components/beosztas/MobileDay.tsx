"use client";

import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import DaySummary from "@/components/beosztas/DaySummary";
import SlotButton from "@/components/beosztas/SlotButton";
import LockHint from "@/components/beosztas/LockHint";
import { SLOT_TIMES, type CellState, type DayCounts } from "@/components/beosztas/state";
import { initialsOf, markKey, addDays, startOfWeek, toISODate, WEEKDAYS_SHORT, weekdayIndex, type SchedPerson } from "@/lib/beosztas";

/*
 * Mobile (<768) month & week share ONE implementation (design spec §3.2/3.3):
 * a tapped 7-day strip + one card per visible person for the selected day.
 */

export interface DayStripProps {
  anchor: Date; // any date whose week is shown
  selected: string; // ISO
  counts: (iso: string) => DayCounts;
  onSelect: (iso: string) => void;
  onPrevDay?: () => void;
  onNextDay?: () => void;
}

export function DayStrip({ anchor, selected, counts, onSelect, onPrevDay, onNextDay }: DayStripProps) {
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const today = toISODate(new Date());
  return (
    <div className="flex items-center gap-1.5">
      {onPrevDay && (
        <button type="button" aria-label="Előző nap" onClick={onPrevDay} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-neutral-border text-ink-muted">
          <IconChevronLeft className="size-4" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 gap-1">
        {days.map((d) => {
          const iso = toISODate(d);
          const c = counts(iso);
          const total = c.yes + c.maybe + c.no + c.none;
          const isSel = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-pressed={isSel}
              aria-label={`${WEEKDAYS_SHORT[weekdayIndex(d)]} ${d.getDate()}.`}
              className={`flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border transition-colors ${
                isSel ? "border-primary/50 bg-primary/[0.15] text-neutral-100" : "border-neutral-border bg-neutral-dark text-[#9aa79e]"
              }`}
            >
              <span className="text-[11px] uppercase tracking-[0.08em]">{WEEKDAYS_SHORT[weekdayIndex(d)].slice(0, 2)}</span>
              <span className={`text-[12.5px] tabular-nums ${iso === today ? "rounded-full bg-primary px-1 font-bold text-[#0b1a10]" : ""}`}>
                {d.getDate()}
              </span>
              <span className="flex h-[3px] w-4/5 overflow-hidden rounded-full bg-[#14281c]">
                {total > 0 && (
                  <>
                    {c.yes > 0 && <span className="h-full opacity-70" style={{ width: `${(c.yes / total) * 100}%`, backgroundColor: "#86e3a0" }} />}
                    {c.maybe > 0 && <span className="h-full opacity-70" style={{ width: `${(c.maybe / total) * 100}%`, backgroundColor: "#e6be5f" }} />}
                    {c.no > 0 && <span className="h-full opacity-70" style={{ width: `${(c.no / total) * 100}%`, backgroundColor: "#ed9a91" }} />}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {onNextDay && (
        <button type="button" aria-label="Következő nap" onClick={onNextDay} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-neutral-border text-ink-muted">
          <IconChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}

export interface MobileDayCardsProps {
  day: string; // ISO
  people: SchedPerson[];
  marks: Map<string, CellState>;
  locks: Record<string, { holder: string; expires_at: string }>;
  myClientId: string;
  pending: Set<string>;
  rowError: Record<string, number>;
  onCycle: (personId: string, day: string, slot: number, dir?: -1 | 1) => void;
  onEditStart: (personId: string) => void;
  onEditEnd: (personId: string) => void;
}

export function MobileDayCards({ day, people, marks, locks, myClientId, pending, rowError, onCycle, onEditStart, onEditEnd }: MobileDayCardsProps) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const label = `${dt.getFullYear()}. ${dt.getMonth() + 1}. ${dt.getDate()}.`;

  return (
    <div className="flex flex-col gap-2">
      {people.map((p) => {
        const lock = locks[p.id];
        const lockedBy = lock && lock.holder !== myClientId ? lock.holder : undefined;
        return (
          <div
            key={p.id}
            className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-3"
            onFocus={() => onEditStart(p.id)}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!next || !e.currentTarget.contains(next)) onEditEnd(p.id);
            }}
          >
            <div className="mb-2 flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-[12px] font-bold text-primary">
                {initialsOf(p.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-neutral-100">{p.name}</span>
              {lockedBy && <LockHint personId={p.id} personName={p.name} holder={lockedBy} />}
            </div>
            <div className="flex gap-2">
              {SLOT_TIMES.map((s) => {
                const k = markKey(p.id, day, s.id);
                return (
                  <div key={s.id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <SlotButton
                      state={marks.get(k) ?? null}
                      personName={p.name}
                      dateLabel={label}
                      slotTime={s.short}
                      density="mobile"
                      lockedOther={!!lockedBy}
                      pending={pending.has(k)}
                      data-cell={k}
                      onCycleKey={(dir) => {
                        onEditStart(p.id);
                        onCycle(p.id, day, s.id, dir);
                      }}
                      onClick={() => {
                        onEditStart(p.id);
                        onCycle(p.id, day, s.id, 1);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {rowError[p.id] && <p className="mt-1 text-[12.5px] text-[#ed9a91]">Nem sikerült menteni – próbáld újra.</p>}
          </div>
        );
      })}
    </div>
  );
}

/* Full-month one-line summary rows (month view's "whole month at a glance"). */
export function MonthSummaryList({
  month,
  dates,
  counts,
  selected,
  onSelect,
  visibleCount,
}: {
  month: number;
  dates: Date[];
  counts: (iso: string) => DayCounts;
  selected: string;
  onSelect: (iso: string) => void;
  visibleCount: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {dates.map((d) => {
        const iso = toISODate(d);
        const c = counts(iso);
        const total = c.yes + c.maybe + c.no + c.none;
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(iso)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
              iso === selected ? "bg-primary/[0.10] ring-1 ring-primary/40" : "bg-neutral-dark/60 hover:bg-[#14281c]"
            }`}
          >
            <span className="w-[86px] shrink-0 text-[12.5px] tabular-nums text-ink-muted">
              {month + 1}. {d.getDate()}. {WEEKDAYS_SHORT[weekdayIndex(d)].toLowerCase()}
            </span>
            <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#14281c]" aria-hidden="true">
              {total > 0 && (
                <>
                  {c.yes > 0 && <span className="h-full opacity-70" style={{ width: `${(c.yes / total) * 100}%`, backgroundColor: "#86e3a0" }} />}
                  {c.maybe > 0 && <span className="h-full opacity-70" style={{ width: `${(c.maybe / total) * 100}%`, backgroundColor: "#e6be5f" }} />}
                  {c.no > 0 && <span className="h-full opacity-70" style={{ width: `${(c.no / total) * 100}%`, backgroundColor: "#ed9a91" }} />}
                </>
              )}
            </span>
            <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">
              {c.yes}/{visibleCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { DaySummary };
