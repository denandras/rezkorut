"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type Task, type TaskStatus, COLUMNS } from "@/lib/supabase";
import TaskCard from "@/components/kanban/TaskCard";

type ColumnProps = {
  column: { id: TaskStatus; label: string; color: string };
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
};

export default function Column({ column, tasks, onEdit, onDelete }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className="flex min-w-[260px] max-w-[320px] flex-1 flex-col w-full md:w-auto">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: column.color }}
        />
        <span className="font-display text-sm font-semibold text-neutral-200">
          {column.label}
        </span>
        <span className="text-xs text-neutral-500">{tasks.length}</span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-xl border p-2 min-h-[200px] transition-colors ${
          isOver
            ? "border-primary/40 bg-neutral-dark/80"
            : "border-neutral-border bg-neutral-dark/40"
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
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
        </SortableContext>
      </div>
    </div>
  );
}