"use client";

import { useState, useEffect } from "react";

const SESSION_KEY = "rezkorut-intern-auth";

const PASSWORD = process.env.NEXT_PUBLIC_INTERN_PASSWORD ?? "";

const links = [
  {
    title: "Próbarend",
    description: "Május",
    href: "https://rallly.co/invite/zK9ZVLoULvw7",
  },
  {
    title: "Kották",
    description: "Felhő – kottafájlok",
    href: "https://storage.denandras.cloud/index.php/s/aB4iyD6jYP5x8Z3",
  },
  {
    title: "Dokumentumok & média",
    description: "Felhő – dokumentumok és médiafájlok",
    href: "https://storage.denandras.cloud/index.php/s/jMgmoRqe6coE9ys",
  },
  {
    title: "Infók, darabok, személyek",
    description: "Notion – együttes wiki",
    href: "https://andrasdenes.notion.site/rezkorut?source=copy_link",
  },
];

export default function InternPage() {
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
            {error && (
              <p className="text-xs text-red-400">Helytelen jelszó.</p>
            )}
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-display mb-1 text-xs font-bold tracking-[0.2em] text-primary uppercase">
          Réz körút
        </p>
        <h1 className="font-display mb-8 text-2xl font-bold text-neutral-100">
          Intern
        </h1>
        <div className="flex flex-col gap-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col rounded-xl border border-neutral-border bg-neutral-dark/60 px-5 py-4 transition-colors hover:border-primary/50 hover:bg-neutral-dark"
            >
              <span className="font-display text-base font-semibold text-neutral-100">
                {link.title}
              </span>
              <span className="mt-0.5 text-xs text-neutral-400">
                {link.description}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
