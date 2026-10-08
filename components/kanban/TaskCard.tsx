"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type Task,
  type TaskStatus,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  CATEGORY_LABELS,
  COLUMNS,
} from "@/lib/supabase";

const MENU_W = 176; // w-44
const MENU_H = 210; // 5 items, approximate

type DropdownPos = { left: number; top?: number; bottom?: number };

function StatusDropdown({
  task,
  onStateChange,
  onOpenChange,
}: {
  task: Task;
  onStateChange: (newState: TaskStatus) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  function setOpenBoth(next: boolean) {
    setOpen(next);
    onOpenChange(next);
  }

  function close() {
    setOpenBoth(false);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
    // Open upward when there is not enough room below (bottom nav ≈ 64px)
    const up = r.bottom + MENU_H > window.innerHeight - 64;
    setPos(
      up
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 }
    );
    setOpenBoth(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function choose(e: React.MouseEvent, newState: TaskStatus) {
    e.stopPropagation();
    close();
    if (newState !== task.state) onStateChange(newState);
  }

  const current = COLUMNS.find((c) => c.id === task.state) ?? COLUMNS[0];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Státusz módosítása"
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-neutral-300 bg-neutral-700/40 hover:bg-neutral-700/70 transition-colors"
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: current.color }}
        />
        {current.label}
        <svg
          className={`w-2.5 h-2.5 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open &&
        mounted &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={
              pos.top != null
                ? { top: pos.top, left: pos.left, width: MENU_W }
                : { bottom: pos.bottom, left: pos.left, width: MENU_W }
            }
            className="fixed z-[60] rounded-xl border border-neutral-border bg-neutral-dark py-1 shadow-xl"
          >
            {COLUMNS.map((col) => (
              <button
                key={col.id}
                type="button"
                role="menuitem"
                onClick={(e) => choose(e, col.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  col.id === task.state
                    ? "text-neutral-100 bg-neutral-700/40"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/60"
                }`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <span className="flex-1 text-left">{col.label}</span>
                {col.id === task.state && (
                  <svg
                    className="size-3 text-neutral-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

type TaskCardProps = {
  task: Task;
  onEdit?: () => void;
  onDelete?: () => void;
  onStateChange?: (newState: TaskStatus) => void;
  isOverlay?: boolean;
  isMobile?: boolean;
};

export default function TaskCard({
  task,
  onEdit,
  onDelete,
  onStateChange,
  isOverlay,
  isMobile,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isOverlay || isMobile });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);

  function handleOpenChange(open: boolean) {
    menuOpenRef.current = open;
    setMenuOpen(open);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : null;

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.state !== "done";

  const completedDate = task.completed_at
    ? new Date(task.completed_at).toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : null;

  // On mobile: entire card is a tap target to open the task (DnD off —
  // scrolling gestures on cards never start a drag; status changes go
  // through the inline dropdown). If the menu is open, first tap closes it.
  // On desktop: drag listeners on the card, title click opens.
  const cardProps = isMobile
    ? {
        onClick: (e: React.MouseEvent) => {
          if (isOverlay) return;
          if (menuOpenRef.current) {
            e.stopPropagation();
            handleOpenChange(false);
            return;
          }
          e.stopPropagation();
          onEdit?.();
        },
      }
    : {
        ...attributes,
        ...listeners,
      };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...cardProps}
      className={`group relative rounded-lg border bg-neutral-dark/80 p-3 transition-shadow select-none ${
        isMobile
          ? "cursor-pointer active:bg-neutral-dark/60"
          : "cursor-grab active:cursor-grabbing touch-none"
      } ${
        isDragging ? "opacity-40 border-primary/50" : "border-neutral-border hover:border-neutral-500"
      } ${isOverlay ? "shadow-lg border-primary/50 rotate-2" : ""}`}
    >
      {/* Title — on desktop, clicking title opens the task (stops drag propagation) */}
      <p
        onClick={!isMobile && !isOverlay ? (e) => { e.stopPropagation(); onEdit?.(); } : undefined}
        className={`text-sm font-medium text-neutral-100 leading-snug mb-2 ${
          isMobile ? "" : "cursor-pointer hover:text-primary transition-colors"
        }`}
      >
        {task.title}
      </p>

      {/* Badges — status is an inline dropdown (no drag needed, no native select) */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        <StatusDropdown
          task={task}
          onStateChange={(ns) => onStateChange?.(ns)}
          onOpenChange={handleOpenChange}
        />
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-neutral-400 bg-neutral-700/40">
          {CATEGORY_LABELS[task.category]}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
          style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}20`, color: PRIORITY_COLORS[task.priority] }}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
          {task.assignee_name && <span>{task.assignee_name}</span>}
          {dueDate && (
            <span className={isOverdue ? "text-red-400" : ""}>
              📅 {dueDate}
            </span>
          )}
          {completedDate && (
            <span className="text-green-500/70">
              ✓ {completedDate}
            </span>
          )}
        </div>
        {!isOverlay && (
          <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="text-neutral-500 hover:text-primary"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-neutral-500 hover:text-red-400"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}