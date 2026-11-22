"use client";

import { Fragment } from "react";
import SlotButton from "@/components/beosztas/SlotButton";
import LockHint from "@/components/beosztas/LockHint";
import { SLOT_TIMES, type CellState } from "@/components/beosztas/state";
import { initialsOf, markKey } from "@/lib/beosztas";

/*
 * One person's row: label cell (+ totals, lock hint) then one cell per day,
 * each stacking the 3 slots vertically (design spec §3.1). No border-b between
 * people — the row is separated by the card gap and tracks by hover tint.
 */

export interface PersonRowProps {
  personName: string;
  personId: string;
  days: Date[]; // Mon..Sun (or the month's days in the band)
  marks: Map<string, CellState>;
  lockedBy?: string;
  failed?: boolean;
  pending: Set<string>;
  density: "month" | "week";
  dateLabel: (d: Date) => string;
  iso: (d: Date) => string;
  onCycle: (personId: string, day: string, slot: number, dir?: -1 | 1) => void;
  onEditStart: (personId: string) => void;
  onEditEnd: (personId: string) => void;
  /** Roving tabindex cell key for keyboard nav. */
  focusedCell?: string | null;
  /**
   * "flat": render the grid CONTENT only (label cell + 7 cell wrappers as
   * direct grid items, for use inside a parent grid). "row": render a
   * self-contained grid for the week board (7 days only).
   */
  layout?: "flat" | "row";
}

export default function PersonRow({
  personName,
  personId,
  days,
  marks,
  lockedBy,
  failed,
  pending,
  density,
  dateLabel,
  iso,
  onCycle,
  onEditStart,
  onEditEnd,
  focusedCell,
  layout = "row",
}: PersonRowProps) {
  let yes = 0;
  let maybe = 0;
  for (const d of days) {
    for (const s of SLOT_TIMES) {
      const st = marks.get(markKey(personId, iso(d), s.id));
      if (st === "yes") yes++;
      else if (st === "maybe") maybe++;
    }
  }

  const labelCell = (
    <div
      role="rowheader"
      className={`flex min-w-0 items-center gap-2 px-2 ${density === "month" ? "min-h-11" : "min-h-[148px] items-start py-4 border-t border-neutral-border/60 first:border-t-0"}`}
      onFocus={() => onEditStart(personId)}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) onEditEnd(personId);
      }}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-[12px] font-bold tracking-wide text-primary">
        {initialsOf(personName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-neutral-100">{personName}</p>
        <p className="mt-0.5 text-[12px] tabular-nums text-ink-faint">
          {yes} ráér · {maybe} talán
        </p>
        {failed && <p className="mt-0.5 text-[12.5px] text-[#ed9a91]">Nem sikerült menteni – próbáld újra.</p>}
      </div>
      {lockedBy && <LockHint personId={personId} personName={personName} holder={lockedBy} />}
    </div>
  );

  const cellFor = (d: Date) => {
    const day = iso(d);
    // Month = at-a-glance: the three slots sit SIDE BY SIDE in one compact row
    // (glyph-only, legend at the header). Week = detail: they stack with their
    // time labels. Stacking three 40px rows in the month grid made one month
    // ~7500px tall — six screens for a glance.
    const isMonth = density === "month";
    return (
      <div
        key={day}
        role="gridcell"
        className={`flex rounded-lg px-0.5 py-0.5 transition-colors group-hover/row:bg-[#14281c]/40 ${
          isMonth ? "flex-row" : "flex-col"
        }`}
        style={{ gap: isMonth ? "3px" : density === "week" ? "6px" : "4px" }}
        onFocus={() => onEditStart(personId)}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) onEditEnd(personId);
        }}
      >
        {SLOT_TIMES.map((s) => {
          const k = markKey(personId, day, s.id);
          return (
            <SlotButton
              key={s.id}
              state={marks.get(k) ?? null}
              personName={personName}
              dateLabel={dateLabel(d)}
              slotTime={density === "week" ? s.short : s.label}
              density={density}
              lockedOther={!!lockedBy}
              pending={pending.has(k)}
              tabIndex={focusedCell === k ? 0 : -1}
              data-cell={k}
              onCycleKey={(dir) => {
                onEditStart(personId);
                onCycle(personId, day, s.id, dir);
              }}
              onClick={() => {
                onEditStart(personId);
                onCycle(personId, day, s.id, 1);
              }}
            />
          );
        })}
      </div>
    );
  };

  if (layout === "flat") {
    // A Fragment keeps every cell a DIRECT grid item of the parent band grid
    // (no wrapper box, no display:contents dependency). Row-level focus/blur is
    // wired on the buttons themselves (focus → start lock, blur → release).
    return (
      <Fragment>
        {labelCell}
        {days.map((d) => cellFor(d))}
      </Fragment>
    );
  }

  return (
    <div
      role="row"
      className="group/row grid items-stretch"
      style={{ gridTemplateColumns: "160px repeat(7, minmax(0, 1fr))", gap: "6px" }}
      onFocus={() => onEditStart(personId)}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) onEditEnd(personId);
      }}
    >
      {labelCell}
      {days.map(cellFor)}
    </div>
  );
}
