"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { supabase, type Task, type TaskStatus, COLUMNS } from "@/lib/supabase";
import Column from "@/components/kanban/Column";
import TaskCard from "@/components/kanban/TaskCard";
import TaskForm from "@/components/kanban/TaskForm";

export default function KanbanBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("Fetch error:", error);
      return;
    }
    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();

    const channel = supabase
      .channel("tasks-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        fetchTasks();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTasks]);

  function handleDragStart(e: DragStartEvent) {
    const task = tasks.find((t) => t.id === e.active.id);
    setActiveTask(task || null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Determine target column
    let targetState: TaskStatus | null = null;

    // Check if overId is a column id
    const col = COLUMNS.find((c) => c.id === overId);
    if (col) {
      targetState = col.id;
    } else {
      // overId is a task id — find its column
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        targetState = overTask.state;
      }
    }

    if (!targetState) return;

    const task = tasks.find((t) => t.id === activeId);
    if (!task || task.state === targetState) {
      // Reorder within same column
      return;
    }

    // Update task state
    const newState = targetState;
    const { error } = await supabase
      .from("tasks")
      .update({ state: newState })
      .eq("id", activeId);

    if (error) console.error("Update error:", error);
  }

  async function handleCreate(data: Partial<Task>) {
    const maxSort = tasks
      .filter((t) => t.state === "todo")
      .reduce((max, t) => Math.max(max, t.sort_order), 0);
    const { error } = await supabase.from("tasks").insert({
      title: data.title,
      description: data.description || "",
      state: "todo",
      sort_order: maxSort + 1,
      priority: data.priority || "medium",
      category: data.category || "general",
      assignee_name: data.assignee_name || "",
      due_date: data.due_date || null,
      project_id: null,
    });
    if (error) console.error("Create error:", error);
    setShowForm(false);
  }

  async function handleUpdate(id: string, data: Partial<Task>) {
    const { error } = await supabase.from("tasks").update(data).eq("id", id);
    if (error) console.error("Update error:", error);
    setEditingTask(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Biztosan törlöd ezt a feladatot?")) return;
    // Optimistic: remove from UI immediately
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      console.error("Delete error:", error);
      // Re-fetch to restore on failure
      fetchTasks();
    }
  }

  const filteredTasks = filter.trim()
    ? tasks.filter((t) =>
        t.title.toLowerCase().includes(filter.toLowerCase().trim()) ||
        (t.assignee_name || "").toLowerCase().includes(filter.toLowerCase().trim())
      )
    : tasks;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        <p className="text-sm">Betöltés…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-neutral-100">Kanban</h2>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-80"
          >
            + Új feladat
          </button>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Keresés névre vagy címre…"
          className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary"
        />
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col gap-3 overflow-x-auto pb-4 flex-1 min-h-0 md:flex-row">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={filteredTasks.filter((t) => t.state === col.id)}
              onEdit={setEditingTask}
              onDelete={handleDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* Create/Edit form */}
      {(showForm || editingTask) && (
        <TaskForm
          task={editingTask}
          onSubmit={(data) => {
            if (editingTask) {
              handleUpdate(editingTask.id, data);
            } else {
              handleCreate(data);
            }
          }}
          onClose={() => {
            setShowForm(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}