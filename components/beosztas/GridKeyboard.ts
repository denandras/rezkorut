"use client";

import { useCallback, useRef, useState } from "react";

/*
 * Roving tabindex over the schedule grid (design spec §5.2).
 * Exactly one cell is tabbable; arrows move the focus, Enter/Space cycle,
 * Shift+Enter cycles backwards, Home/End jump to the row's ends.
 *
 * The grid is a flat document order of buttons[data-cell]; we derive
 * day (x) and slot (y) from the DOM positions on each keypress so the hook
 * stays layout-agnostic (month bands and week grid share it).
 */

export function useGridKeyboard(gridRef: React.RefObject<HTMLDivElement | null>) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);

  const cells = useCallback((): HTMLButtonElement[] => {
    if (!gridRef.current) return [];
    return Array.from(gridRef.current.querySelectorAll<HTMLButtonElement>("button[data-cell]"));
  }, [gridRef]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const all = cells();
      if (all.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? all.indexOf(active as HTMLButtonElement) : -1;
      if (idx < 0) return;

      const key = all[idx].dataset.cell ?? String(idx);
      lastKey.current = key;

      const focusAt = (i: number) => {
        const t = all[Math.max(0, Math.min(all.length - 1, i))];
        if (!t) return;
        t.focus({ preventScroll: false });
        setFocusKey(t.dataset.cell ?? null);
        t.scrollIntoView({ block: "nearest", inline: "nearest" });
      };

      // In a band/grid each person row has 7 days × 3 slots in DOM order.
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          focusAt(idx + 3);
          break;
        case "ArrowLeft":
          e.preventDefault();
          focusAt(idx - 3);
          break;
        case "ArrowDown":
          e.preventDefault();
          focusAt(idx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusAt(idx - 1);
          break;
        case "Home":
          e.preventDefault();
          focusAt(idx - (idx % 21));
          break;
        case "End":
          e.preventDefault();
          focusAt(idx - (idx % 21) + 20);
          break;
        default:
          break;
      }
      // Enter/Space/shift+Enter are handled by SlotButton (per-cell cycle).
    },
    [cells]
  );

  return { focusKey, onKeyDown };
}
