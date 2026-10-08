"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type Task, type TaskStatus } from "@/lib/supabase";
import TaskCard from "@/components/kanban/TaskCard";

type ColumnProps = {
  column: { id: TaskStatus; label: string; color: string };
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onStateChange: (id: string, newState: TaskStatus) => void;
  isMobile?: boolean;
  /** Box-mode columns (done/archived): collapsed = show as a closed box. */
  collapsed?: boolean;
  onToggle?: () => void;
};

export default function Column({
  column,
  tasks,
  onEdit,
  onDelete,
  onStateChange,
  isMobile,
  collapsed,
  onToggle,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: isMobile });

  const isBoxColumn = collapsed !== undefined;
  const isCollapsed = isBoxColumn && collapsed;

  const cards = (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          isMobile={isMobile}
          onEdit={() => onEdit(task)}
          onDelete={() => onDelete(task.id)}
        />
      ))}
      {tasks.length === 0 && (
        <p className="text-center text-xs text-neutral-600 py-8">
          Üres
        </p>
      )}
    </div>
  );

  const header = (
    <div className="flex items-center gap-2 mb-2 px-1">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: column.color }}
      />
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="font-display text-sm font-semibold text-neutral-200 transition-colors hover:text-neutral-100"
        >
          {column.label}
        </button>
      ) : (
        <span className="font-display text-sm font-semibold text-neutral-200">
          {column.label}
        </span>
      )}
      <span className="text-xs text-neutral-500">{tasks.length}</span>
      {isBoxColumn && !collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Összecsukás"
          className="ml-auto rounded p-1 text-neutral-500 transition-colors hover:text-neutral-200"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      )}
    </div>
  );

  // Collapsed box: cards hidden, but still a droppable target so tasks
  // can be thrown in without opening it. Click to open.
  if (isCollapsed) {
    return (
      <div className="flex min-w-[260px] max-w-[320px] flex-1 flex-col w-full md:w-auto h-full min-h-0">
        {header}
        <button
          ref={setNodeRef}
          type="button"
          onClick={onToggle}
          title="Elrejtett feladatok megnyitása"
          className={`flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center transition-colors ${
            isOver
              ? "border-primary/40 bg-neutral-dark/80"
              : "border-neutral-border bg-neutral-dark/40 hover:border-neutral-600"
          }`}
        >
          <svg
            className="size-6 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
          </svg>
          <span className="text-xs text-neutral-500">
            Feladatok elrejtve — kattints a megnyitáshoz
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-[260px] max-w-[320px] flex-1 flex-col w-full md:w-auto h-full min-h-0">
      {header}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-xl border p-2 min-h-[200px] transition-colors overflow-y-auto ${
          isMobile
            ? "border-neutral-border bg-neutral-dark/40"
            : isOver
              ? "border-primary/40 bg-neutral-dark/80"
              : "border-neutral-border bg-neutral-dark/40"
        }`}
      >
        {isMobile ? (
          cards
        ) : (
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {cards}
          </SortableContext>
        )}
      </div>
    </div>
  );
}