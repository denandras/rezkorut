"use client";

import { useState, useEffect } from "react";
import BottomNav from "@/components/bottom-nav";
import KanbanBoard from "@/components/kanban/Board";

const SESSION_KEY = "rezkorut-intern-auth";
const PASSWORD = process.env.NEXT_PUBLIC_INTERN_PASSWORD ?? "";

export default function KanbanPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setAuthed(true);
    }
    setReady(true);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setAuthed(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  if (!ready) return null;

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark px-6">
        <div className="w-full max-w-xs">
          <p className="font-display mb-1 text-xs font-bold tracking-[0.2em] text-primary uppercase">
            Réz körút
          </p>
          <h1 className="font-display mb-6 text-2xl font-bold text-neutral-100">
            Intern
          </h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              autoFocus
              placeholder="Jelszó"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              className="rounded-lg border border-neutral-border bg-neutral-dark px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-primary"
            />
            {error && <p className="text-xs text-red-400">Helytelen jelszó.</p>}
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-80"
            >
              Belépés
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-dark">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">
        {/* Back link */}
        <div className="mb-4">
          <a
            href="/intern"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza az internhez
          </a>
        </div>
        <KanbanBoard />
      </main>
      <BottomNav active="none" />
    </div>
  );
}