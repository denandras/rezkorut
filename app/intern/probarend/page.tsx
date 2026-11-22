"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import BottomNav from "@/components/bottom-nav";
import BeosztasBoard from "@/components/beosztas/BeosztasBoard";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";
import { InternTitle } from "@/components/intern-title";

export default function BeosztasPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(true);
  const [queued, setQueued] = useState(0);
  const refetchRef = useRef<() => void>(() => {});

  const onLiveChange = useCallback((v: boolean) => setLive(v), []);
  const onQueueChange = useCallback((n: number) => setQueued(n), []);
  const registerRefetch = useCallback((fn: () => void) => {
    refetchRef.current = fn;
  }, []);

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
          <InternTitle />
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
    // The page scrolls; no inner scroll containers anywhere in the grid.
    <div className="min-h-dvh bg-background-dark">
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
        {/* top line: back link left, live connection right */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <a
            href="/intern"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza az internhez
          </a>
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            <span
              className={`size-1.5 rounded-full transition-colors ${live ? "bg-[#86e3a0]" : "bg-[#94a29a]"}`}
              aria-hidden="true"
            />
            {queued > 0 ? (
              `${queued} jelölés szinkronizálásra vár`
            ) : live ? (
              "Élő kapcsolat"
            ) : (
              <>
                <span>Nincs élő kapcsolat –</span>
                <button type="button" onClick={() => refetchRef.current()} className="underline hover:text-primary">
                  újratöltés
                </button>
              </>
            )}
          </p>
        </div>
        <BeosztasBoard onLiveChange={onLiveChange} registerRefetch={registerRefetch} onQueueChange={onQueueChange} />
      </main>
      <BottomNav active="none" />
    </div>
  );
}
