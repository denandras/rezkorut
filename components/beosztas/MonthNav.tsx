"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import { MONTHS } from "@/lib/beosztas";

/*
 * Month navigation (§2.4). The label opens a custom popover (role=dialog) —
 * desktop: anchored below; mobile: centred bottom sheet. No native <select>.
 */
export default function MonthNav({
  year,
  month,
  onChange,
}: {
  year: number;
  month: number; // 0-based
  onChange: (y: number, m: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickYearState, setPickYear] = useState<number | null>(null);
  // Derived while closed: the popover always opens on the month in view.
  const pickYear = pickYearState ?? year;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const btn = "flex size-10 shrink-0 items-center justify-center rounded-full border border-neutral-border text-ink-muted transition-colors hover:border-primary/50 hover:text-primary sm:size-10 size-11";

  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center gap-1.5">
      <button type="button" aria-label="Előző hónap" className={btn} onClick={() => onChange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)}>
        <IconChevronLeft className="size-4" />
      </button>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-10 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold text-neutral-100 tabular-nums transition-colors hover:bg-neutral-dark sm:px-4 sm:text-[15px]"
      >
        {year}. {MONTHS[month]}
      </button>

      <button type="button" aria-label="Következő hónap" className={btn} onClick={() => onChange(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)}>
        <IconChevronRight className="size-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Ugrás hónapra"
            className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-neutral-border bg-neutral-dark p-4 pb-8 shadow-[0_-8px_32px_rgba(0,0,0,0.5)] sm:absolute sm:inset-x-auto sm:left-1/2 sm:top-full sm:mt-2 sm:w-[312px] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:p-3 sm:pb-3 sm:shadow-none"
          >
            <div className="mb-3 flex items-center justify-between">
              <button type="button" aria-label="Előző év" className="flex size-9 items-center justify-center rounded-full text-ink-muted hover:text-primary" onClick={() => setPickYear((y) => (y ?? year) - 1)}>
                <IconChevronLeft className="size-4" />
              </button>
              <span className="text-[14px] font-semibold text-neutral-100 tabular-nums">{pickYear}</span>
              <button type="button" aria-label="Következő év" className="flex size-9 items-center justify-center rounded-full text-ink-muted hover:text-primary" onClick={() => setPickYear((y) => (y ?? year) + 1)}>
                <IconChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((m, i) => {
                const isCurrent = pickYear === year && i === month;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onChange(pickYear, i);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    aria-current={isCurrent ? "true" : undefined}
                    className={`h-10 rounded-full text-[13.5px] transition-colors ${
                      isCurrent ? "bg-primary text-[#0b1a10]" : "text-ink-muted hover:bg-[#14281c] hover:text-neutral-100"
                    }`}
                  >
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 h-11 w-full rounded-xl border border-neutral-border text-[13.5px] text-ink-muted hover:text-neutral-100 sm:hidden"
            >
              Bezárás
            </button>
          </div>
        </>
      )}
    </div>
  );
}
