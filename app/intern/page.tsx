"use client";

import { useState, useEffect } from "react";
import BottomNav from "@/components/bottom-nav";
import {
  IconDocs,
  IconGallery,
  IconInfo,
  IconKanban,
  IconScore,
  IconWaveform,
} from "@/components/icons";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";
import { InternTitle } from "@/components/intern-title";

const links = [
  {
    title: "Kanban",
    description: "Feladatkezelő – kották, próbák, koncertek",
    href: "/intern/kanban",
    icon: IconKanban,
  },
  {
    title: "Felvételek",
    description: "Réz körút hang- és videófelvételek",
    href: "/intern/media",
    icon: IconWaveform,
  },
  {
    title: "Képek",
    description: "Fotógaléria – mappák, képek, letöltés",
    href: "/intern/kepek",
    icon: IconGallery,
  },
  {
    title: "Kották",
    description: "Szeptett kottatár – PDF-ek letöltése",
    href: "/intern/kottak",
    icon: IconScore,
  },
  {
    title: "Dokumentumok & média",
    description: "Felhő – dokumentumok és médiafájlok",
    href: "https://storage.denandras.cloud/index.php/s/kXqjCsJMMTSgzkX",
    icon: IconDocs,
  },
  {
    title: "Infók, darabok, személyek",
    description: "Notion – együttes wiki",
    href: "https://rezkorut.notion.site/R-z-k-r-t-a6fb4a7d4bd8830b865081c4c1eb686a",
    icon: IconInfo,
  },
];

export default function InternPage() {
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
      window.scrollTo(0, 0);
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
    <div className="min-h-screen bg-background-dark">
      <main className="px-4 pb-24 pt-12 md:flex md:min-h-screen md:items-center md:justify-center md:pt-0">
        <div className="w-full max-w-md mx-auto md:max-w-sm">
          <InternTitle />
          <div className="flex flex-col gap-3">
            {links.map((link) => {
              const isInternal = link.href.startsWith("/");
              const Icon = link.icon;
              return (
              <a
                key={link.href}
                href={link.href}
                {...(isInternal ? {} : { target: "_blank", rel: "noreferrer" })}
                className="group flex items-center gap-4 rounded-xl border border-neutral-border bg-neutral-dark/60 px-4 py-4 transition-colors active:bg-neutral-dark hover:border-primary/50 hover:bg-neutral-dark"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary transition-colors group-hover:border-primary/50 group-hover:bg-primary/15">
                  <Icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-display text-base font-semibold text-neutral-100">
                    {link.title}
                  </span>
                  <span className="mt-0.5 text-xs text-neutral-400">
                    {link.description}
                  </span>
                </span>
                <svg className="ml-1 size-4 shrink-0 text-neutral-600 transition-colors group-hover:text-primary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
              );
            })}
          </div>
        </div>
      </main>
      <BottomNav active="none" />
    </div>
  );
}
