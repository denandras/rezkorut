"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BottomNav from "@/components/bottom-nav";
import { IconDownload } from "@/components/icons";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";
import { formatBytes, type KottakFile, type KottakFolder } from "@/lib/kottak";

type Listing = {
  path: string;
  folders: KottakFolder[];
  files: KottakFile[];
  breadcrumbs: KottakFolder[];
};

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.06.44l1.4 1.4a1.5 1.5 0 0 0 1.06.44h6.28A1.5 1.5 0 0 1 20 9.78v7.72A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </svg>
  );
}

const KIND_BADGE: Record<string, string> = {
  pdf: "PDF",
  audio: "HANG",
  video: "VIDEÓ",
  project: "PROJEKT",
  other: "FÁJL",
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function KottakPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (getInternAuth()) setAuthed(true);
    setReady(true);

    setPath(new URLSearchParams(window.location.search).get("p") ?? "");

    const onPop = () => {
      setPath(new URLSearchParams(window.location.search).get("p") ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    setPath(nextPath);
    setQuery("");
    const url = nextPath
      ? `/intern/kottak?p=${encodeURIComponent(nextPath)}`
      : "/intern/kottak";
    window.history.pushState({ p: nextPath }, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const load = useCallback(async (targetPath: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/intern/kottak/list${targetPath ? `?p=${encodeURIComponent(targetPath)}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as Listing;
      setListing(data);
    } catch {
      setLoadError("Nem sikerült betölteni a mappát.");
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) load(path);
  }, [authed, path, load]);

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

  const needle = normalizeText(query.trim());
  const folders = useMemo(() => {
    const all = listing?.folders ?? [];
    return needle ? all.filter((f) => normalizeText(f.name).includes(needle)) : all;
  }, [listing, needle]);
  const files = useMemo(() => {
    const all = listing?.files ?? [];
    return needle ? all.filter((f) => normalizeText(f.name).includes(needle)) : all;
  }, [listing, needle]);

  if (!ready) return null;

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark px-6">
        <div className="w-full max-w-xs">
          <p className="font-display mb-1 text-xs font-bold tracking-[0.2em] text-primary uppercase">
            Réz körút
          </p>
          <h1 className="font-display mb-6 text-2xl font-bold text-neutral-100">Intern</h1>
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

  const breadcrumbs = listing?.breadcrumbs ?? [];
  const rootFolders = listing?.folders ?? [];

  return (
    <div className="min-h-screen bg-background-dark">
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6">
        {/* Top bar */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <a
            href="/intern"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="size-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Intern
          </a>
          <span className="text-[11px] uppercase tracking-[0.18em] text-neutral-600">
            Kották
          </span>
        </div>

        {/* Breadcrumbs */}
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
          <button
            type="button"
            onClick={() => navigate("")}
            className={`rounded px-1.5 py-1 transition-colors hover:text-primary ${
              path === "" ? "text-neutral-200" : ""
            }`}
          >
            Kották
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3 text-neutral-700" />
              <button
                type="button"
                onClick={() => navigate(crumb.path)}
                className={`max-w-[45vw] truncate rounded px-1.5 py-1 transition-colors hover:text-primary ${
                  i === breadcrumbs.length - 1 ? "text-neutral-200" : ""
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="mb-4">
          <h1 className="font-display text-lg font-bold text-neutral-100">
            {path ? breadcrumbs[breadcrumbs.length - 1]?.name ?? path : "Kották"}
          </h1>
          {listing && (
            <p className="mt-0.5 text-xs text-neutral-500">
              Réz körút szeptett kottatár · {rootFolders.length} mappa ·{" "}
              {rootFolders.reduce((sum, f) => sum + f.fileCount, 0) + files.length} fájl ·{" "}
              {formatBytes(
                rootFolders.reduce((sum, f) => sum + f.totalSize, 0) +
                  files.reduce((sum, f) => sum + f.size, 0),
              )}
            </p>
          )}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="search"
            inputMode="search"
            placeholder="Keresés a mappában…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-neutral-border bg-neutral-dark px-4 py-2.5 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-primary"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-neutral-500">Betöltés…</p>
          </div>
        )}

        {loadError && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {!loading && !loadError && (
          <>
            {folders.length > 0 && (
              <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {folders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => navigate(folder.path)}
                    className="group flex items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/50 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-neutral-dark"
                  >
                    <FolderIcon className="size-5 shrink-0 text-primary/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-100">
                        {folder.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        {folder.fileCount} fájl · {formatBytes(folder.totalSize)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-neutral-600 transition-colors group-hover:text-primary/70" />
                  </button>
                ))}
              </div>
            )}

            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/50 px-3 py-2.5"
                  >
                    <span className="shrink-0 rounded-md border border-neutral-border bg-neutral-dark px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-400">
                      {KIND_BADGE[file.kind] ?? "FÁJL"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm leading-snug text-neutral-100">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {formatBytes(file.size)}
                        {file.ext ? ` · ${file.ext}` : ""}
                      </p>
                    </div>
                    <a
                      href={file.downloadUrl}
                      download
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                      aria-label={`${file.name} letöltése`}
                    >
                      <IconDownload className="size-3.5" />
                      <span className="hidden sm:inline">Letöltés</span>
                    </a>
                  </div>
                ))}
              </div>
            )}

            {folders.length === 0 && files.length === 0 && (
              <p className="py-10 text-center text-sm text-neutral-600">
                {needle ? "Nincs találat." : "Ez a mappa üres."}
              </p>
            )}
          </>
        )}
      </main>

      <BottomNav active="none" />
    </div>
  );
}
