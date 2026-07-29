"use client";

import { useState, useEffect } from "react";
import {
  type Task,
  type Priority,
  type Category,
  PRIORITY_LABELS,
  CATEGORY_LABELS,
} from "@/lib/supabase";

type TaskFormProps = {
  task?: Task | null;
  onSubmit: (data: Partial<Task>) => void;
  onClose: () => void;
};

export default function TaskForm({ task, onSubmit, onClose }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<Priority>(task?.priority || "medium");
  const [category, setCategory] = useState<Category>(task?.category || "general");
  const [assignee, setAssignee] = useState(task?.assignee_name || "");
  const [dueDate, setDueDate] = useState(task?.due_date || "");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      assignee_name: assignee.trim(),
      due_date: dueDate || null,
    });
  }

  const priorities: Priority[] = ["low", "medium", "high", "urgent"];
  const categories: Category[] = ["scores", "rehearsal", "concert", "admin", "website", "general"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-neutral-border bg-background-dark p-6"
      >
        <h3 className="font-display text-lg font-bold text-neutral-100 mb-4">
          {task ? "Szerkesztés" : "Új feladat"}
        </h3>

        <div className="flex flex-col gap-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Cím</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Mit kell csinálni?"
              className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Leírás</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Részletek…"
              className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary resize-none"
            />
          </div>

          {/* Priority - segmented control */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Prioritás</label>
            <div className="flex gap-1">
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                    priority === p
                      ? "bg-primary text-neutral-900"
                      : "bg-neutral-dark text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Category - segmented control */}
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Kategória</label>
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    category === c
                      ? "bg-primary text-neutral-900"
                      : "bg-neutral-dark text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Assignee + Due date */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-neutral-400 mb-1">Felelős</label>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Név"
                className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-neutral-400 mb-1">Határidő</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-sm text-neutral-100 outline-none focus:border-primary [color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-border px-4 py-2 text-sm font-medium text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Mégse
          </button>
          <button
            type="submit"
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-80"
          >
            {task ? "Mentés" : "Létrehozás"}
          </button>
        </div>
      </form>
    </div>
  );
}