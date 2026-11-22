"use client";

import { useEffect, useRef } from "react";

/*
 * Shared dialog shell for the Beosztás page.
 *
 * Why a component: the page had two overlays (Lehetőségek, Emberek) that both
 * needed the same three things and only one of them did it correctly:
 *
 * 1. BODY SCROLL LOCK — `fixed inset-0` alone does NOT stop the page behind from
 *    scrolling on touch or with the wheel over the backdrop; the mobile browser
 *    scrolls the document underneath and the dialog appears to drift. We lock
 *    `document.body.style.overflow` and compensate the scrollbar width so the
 *    layout doesn't jump when the bar disappears.
 * 2. Escape closes, backdrop click closes, clicks inside never do.
 * 3. Focus moves into the dialog and returns to the trigger on close.
 *
 * The lock is reference-counted so two dialogs (or a dialog opened twice through
 * a stale state) can never leave the page permanently unscrollable.
 */

let lockCount = 0;
let saved: {
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  paddingRight: string;
} | null = null;

/*
 * Scroll lock that actually holds. Measured on this page: `overflow: hidden` on
 * body AND documentElement still let `window.scrollTo` and a wheel event move
 * the page behind the dialog. The only reliable lock is taking the body out of
 * flow with `position: fixed`, pinning it at the negative of the current scroll
 * offset, then restoring the offset on unlock.
 */
function lockBody() {
  if (lockCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const barWidth = window.innerWidth - html.clientWidth;
    saved = {
      scrollY: window.scrollY,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };
    body.style.position = "fixed";
    body.style.top = `-${saved.scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    if (barWidth > 0) body.style.paddingRight = `${barWidth}px`;
  }
  lockCount += 1;
}

function unlockBody() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && saved) {
    const body = document.body;
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.left = saved.left;
    body.style.right = saved.right;
    body.style.width = saved.width;
    body.style.paddingRight = saved.paddingRight;
    window.scrollTo(0, saved.scrollY);
    saved = null;
  }
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that names the dialog (its <h2>) */
  labelledBy: string;
  children: React.ReactNode;
  widthClass?: string;
  /**
   * Where focus goes when the dialog opens.
   * "field" (default) = first [data-autofocus] or input; "dialog" = the panel
   * itself, so a text box is never pre-focused (owner: don't autofocus the
   * name field in Személyek).
   */
  initialFocus?: "field" | "dialog";
}

export default function Modal({ open, onClose, labelledBy, children, widthClass = "max-w-2xl", initialFocus = "field" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // scroll lock
  useEffect(() => {
    if (!open) return;
    lockBody();
    return unlockBody;
  }, [open]);

  // escape + focus
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);

    // Prefer an explicitly marked field; a plain selector list is ordered by DOM
    // position, so the header close button would win over the form input.
    const panel = panelRef.current;
    const target =
      initialFocus === "dialog"
        ? panel
        : (panel?.querySelector<HTMLElement>("[data-autofocus]") ??
          panel?.querySelector<HTMLElement>("input:not([type=hidden]), button, [href], select, textarea"));
    target?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, initialFocus]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overscroll-contain bg-[#06100a]/70 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        // only a press that STARTS on the backdrop closes (not a drag out of the panel)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full ${widthClass} flex-col overflow-hidden rounded-t-2xl border border-neutral-border bg-neutral-dark focus:outline-none sm:max-h-[88dvh] sm:rounded-2xl`}
      >
        {children}
      </div>
    </div>
  );
}
