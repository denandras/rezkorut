import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: { params: { eventsPerSecond: 2 } },
});

export type TaskStatus = "todo" | "pending" | "in_progress" | "done" | "archived";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Category = "scores" | "rehearsal" | "concert" | "admin" | "website" | "general";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  assignee_name: string;
  state: TaskStatus;
  sort_order: number;
  priority: Priority;
  category: Category;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "todo", label: "Teendő", color: "#6b7280" },
  { id: "pending", label: "Függőben", color: "#3b82f6" },
  { id: "in_progress", label: "Folyamatban", color: "#f59e0b" },
  { id: "done", label: "Kész", color: "#10b981" },
  { id: "archived", label: "Archív", color: "#4b5563" },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#6b7280",
  medium: "#eab308",
  high: "#f97316",
  urgent: "#ef4444",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Alacsony",
  medium: "Közepes",
  high: "Magas",
  urgent: "Sürgős",
};

export const CATEGORY_COLORS: Record<Category, string> = {
  scores: "#3b82f6",
  rehearsal: "#a855f7",
  concert: "#ef4444",
  admin: "#6b7280",
  website: "#22c55e",
  general: "#f59e0b",
};

export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const CATEGORY_LABELS: Record<Category, string> = {
  scores: "Kották",
  rehearsal: "Próba",
  concert: "Koncert",
  admin: "Admin",
  website: "Weboldal",
  general: "Egyéb",
};