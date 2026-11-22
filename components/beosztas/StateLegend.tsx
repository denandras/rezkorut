"use client";

import { IconCheck, IconClose, IconQuestion } from "@/components/icons";
import { stateCellClasses, type CellState } from "@/components/beosztas/state";

/*
 * Legend (§1.1). Swatches use the same recipe as the cells, so it can't drift.
 * Unanswered swatch is the empty pill with a faint dash — read as absence.
 */
export default function StateLegend({ className = "" }: { className?: string }) {
  const items: { state: CellState; label: string; aria: string }[] = [
    { state: "yes", label: "Ráérek", aria: "igen – ráérek" },
    { state: "maybe", label: "Ha kell", aria: "talán – ha kell, ott vagyok" },
    { state: "no", label: "Nem érek rá", aria: "nem – nem érek rá" },
    { state: null, label: "Nincs jelölve", aria: "üres – nincs jelölve" },
  ];
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`} aria-label="Jelölések magyarázata">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-2 text-[12.5px] text-ink-muted" aria-label={it.aria}>
          <span
            aria-hidden="true"
            className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border text-[11px] font-bold ${stateCellClasses(it.state)}`}
          >
            {it.state === "yes" && <IconCheck className="size-2.5" />}
            {it.state === "maybe" && <IconQuestion className="size-2.5" />}
            {it.state === "no" && <IconClose className="size-2.5" />}
            {it.state === null && <span className="text-[#7d8b82]" aria-hidden="true">–</span>}
          </span>
          <span aria-hidden="true">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}
