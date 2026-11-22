"use client";

import { IconCheck, IconClose, IconMinus, IconQuestion } from "@/components/icons";
import { ariaChecked, metaOf, stateCellClasses, type CellState } from "@/components/beosztas/state";

/*
 * The cell (design spec §4.1). The ONLY file with the four state class
 * recipes — it imports them from state.ts so the legend can't drift.
 *
 * Rule: unanswered is a faint MINUS in the empty pill (no state colour). Zero
 * (no) is a coral cross. That is the zero-vs-null distinction made visible.
 */

export interface SlotButtonProps {
  state: CellState;
  personName: string;
  dateLabel: string;
  slotTime: string;
  density: "month" | "week" | "mobile";
  onClick: () => void;
  /** Shift+Enter cycles backwards; plain Enter/Space forwards. */
  onCycleKey?: (dir: -1 | 1) => void;
  lockedOther?: boolean;
  pending?: boolean;
  tabIndex?: number;
  /** Automation/debug handle: '<personId>|<YYYY-MM-DD>|<slot>'. */
  "data-cell"?: string;
}

function Glyph({ state, size = 15 }: { state: CellState; size?: number }) {
  if (state === "yes") return <IconCheck className="shrink-0" style={{ width: size, height: size }} />;
  if (state === "maybe") return <IconQuestion className="shrink-0" style={{ width: size, height: size }} />;
  if (state === "no") return <IconClose className="shrink-0" style={{ width: size, height: size }} />;
  // Unmarked is a minus, not a blank: the four states stay readable at a glance.
  return (
    <IconMinus
      className="shrink-0 text-ink-faint opacity-70"
      style={{ width: size, height: size }}
    />
  );
}

export default function SlotButton({
  state,
  personName,
  dateLabel,
  slotTime,
  density,
  onClick,
  onCycleKey,
  lockedOther,
  pending,
  tabIndex,
  ["data-cell"]: dataCell,
}: SlotButtonProps) {
  const meta = metaOf(state);
  const classes = [
    "group relative flex touch-manipulation select-none items-center justify-center scroll-mt-[72px]",
    "rounded-[10px] border text-center font-bold leading-none outline-none",
    "transition-[background-color,border-color,color] duration-150 ease-out active:brightness-95",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1a10]",
    // Month grid = day rows with the three slots SIDE BY SIDE: each button fills
    // its flex-1 wrapper (`w-full`), never `flex-1` itself — a flex-1 child of a
    // flex-1 wrapper collapses to a few pixels.
    density === "month" ? "h-10 w-full text-[15px]" : "h-11 min-h-11 w-full gap-2 px-2.5 text-[15px]",
  ];
  // state classes come from the shared recipes
  if (lockedOther) classes.push("opacity-[0.55]");
  if (pending) classes.push("opacity-70");

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ariaChecked(state)}
      aria-description={state === "maybe" ? "talán" : undefined}
      aria-label={`${personName} · ${dateLabel} · ${slotTime} · ${meta.label}`}
      data-state={state ?? "none"}
      data-cell={dataCell}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onCycleKey) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onCycleKey(e.shiftKey ? -1 : 1);
        }
      }}
      className={`${classes.join(" ")} ${stateCellClasses(state)}`}
    >
      {density !== "month" && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] opacity-70">{slotTime}</span>
      )}
      <Glyph state={state} size={15} />
    </button>
  );
}
