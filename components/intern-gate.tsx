"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { INTERN_PASSWORD, setInternAuth } from "@/lib/intern-auth";
import { InternTitle } from "@/components/intern-title";

/**
 * Client password gate for the server-rendered intern pages (/intern,
 * /intern/koncertek). Same rule as the older client pages — NEXT_PUBLIC
 * INTERN_PASSWORD plus the intern cookie — but on success it refreshes the
 * route so the server component re-renders the authenticated view.
 */
export default function InternGate() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === INTERN_PASSWORD) {
      setInternAuth();
      setError(false);
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark px-6">
      <div className="w-full max-w-xs">
        <InternTitle />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Jelszó"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
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
