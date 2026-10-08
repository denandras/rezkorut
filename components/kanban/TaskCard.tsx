"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type Task,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  CATEGORY_LABELS,
} from "@/lib/supabase";

type TaskCardProps = {
  task: Task;
  onEdit?: () => void;
  onDelete?: () => void;
  isOverlay?: boolean;
  isMobile?: boolean;
};

export default function TaskCard({
  task,
  onEdit,
  onDelete,
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

  // Mobile: the whole card taps to open the edit modal (DnD off — scroll
  // gestures on cards never start a drag). Desktop: drag listeners on the
  // card; title click opens the edit modal. Status lives in the modal (and
  // on the column), not on the card.
  const cardProps = isMobile
    ? {
        onClick: (e: React.MouseEvent) => {
          if (isOverlay) return;
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
      {/* Title — on desktop, clicking opens the edit modal (stops drag propagation) */}
      <p
        onClick={!isMobile && !isOverlay ? (e) => { e.stopPropagation(); onEdit?.(); } : undefined}
        className={`text-sm font-medium text-neutral-100 leading-snug mb-2 ${
          isMobile ? "" : "cursor-pointer hover:text-primary transition-colors"
        }`}
      >
        {task.title}
      </p>

      {/* Badges — status is not shown here; the column the card sits in is the status */}
      <div className="flex flex-wrap gap-1.5 mb-2">
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

      {/* Metadata + delete — actions live in their own stopPropagation zone
          so a click here can never start a drag or bubble into the card. */}
      <div
        className="flex items-center justify-between"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
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
        {!isOverlay && onDelete && (
          <button
            onClick={() => onDelete()}
            title="Törlés"
            aria-label="Törlés"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-red-400/10 hover:text-red-400"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}