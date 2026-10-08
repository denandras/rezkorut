import { useState, useEffect } from "react";

/**
 * Returns true when viewport width is below the `md` breakpoint (768px).
 * Used to switch the kanban board from drag-and-drop (desktop) to
 * tap-to-open with inline status editing (mobile).
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}