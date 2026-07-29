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
};

export default function TaskCard({ task, onEdit, onDelete, isOverlay }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isOverlay });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : null;

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.state !== "done";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative rounded-lg border bg-neutral-dark/80 p-3 cursor-grab active:cursor-grabbing transition-shadow select-none touch-none ${
        isDragging ? "opacity-40 border-primary/50" : "border-neutral-border hover:border-neutral-500"
      } ${isOverlay ? "shadow-lg border-primary/50 rotate-2" : ""}`}
    >
      {/* Title */}
      <p
        onClick={(e) => { if (!isOverlay) { e.stopPropagation(); onEdit?.(); } }}
        className="text-sm font-medium text-neutral-100 leading-snug mb-2 cursor-pointer hover:text-primary transition-colors"
      >
        {task.title}
      </p>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-neutral-400 bg-neutral-700/40">
          {CATEGORY_LABELS[task.category]}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
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