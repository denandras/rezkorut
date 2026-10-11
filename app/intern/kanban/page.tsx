"use client";

import { useState, useEffect } from "react";
import BottomNav from "@/components/bottom-nav";
import KanbanBoard from "@/components/kanban/Board";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";

export default function KanbanPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (getInternAuth()) {
      setAuthed(true);
    }
    setReady(true);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === INTERN_PASSWORD) {
      setInternAuth();
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
              placeholder="Jelszó"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              className="rounded-lg border border-neutral-border bg-neutral-dark px-4 py-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-primary"
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
    // Mobile: min-h-dvh + no overflow lock → the PAGE scrolls and columns grow
    // with their content (no internal column scrolling). Desktop: fixed-height
    // board — the page never scrolls; columns scroll internally (2026-10-08).
    <div className="flex min-h-dvh flex-col bg-background-dark md:h-dvh md:overflow-hidden">
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 w-full flex flex-col md:h-full">
        {/* Back link */}
        <div className="mb-2 shrink-0">
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
        <div className="md:flex-1 md:min-h-0">
          <KanbanBoard />
        </div>
      </main>
      <BottomNav active="none" />
    </div>
  );
}