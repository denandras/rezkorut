"use client";

import { useCallback, useEffect, useState } from "react";
import BottomNav from "@/components/bottom-nav";
import KepekGallery from "@/components/kepek-gallery";
import { IconDownload } from "@/components/icons";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";
import { InternTitle } from "@/components/intern-title";
import type { KepekFile, KepekFolder } from "@/lib/kepek";

type Listing = {
  path: string;
  folders: KepekFolder[];
  files: KepekFile[];
  breadcrumbs: KepekFolder[];
  zipUrl?: string;
};

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.06.44l1.4 1.4a1.5 1.5 0 0 0 1.06.44h6.28A1.5 1.5 0 0 1 20 9.78v7.72A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function KepekPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- Auth ---
  useEffect(() => {
    if (getInternAuth()) setAuthed(true);
    setReady(true);

    const params = new URLSearchParams(window.location.search);
    setPath(params.get("p") ?? "");

    const onPop = () => {
      const p = new URLSearchParams(window.location.search).get("p") ?? "";
      setPath(p);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((nextPath: string, push = true) => {
    setPath(nextPath);
    const url = nextPath
      ? `/intern/kepek?p=${encodeURIComponent(nextPath)}`
      : "/intern/kepek";
    if (push) window.history.pushState({ p: nextPath }, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const load = useCallback(async (targetPath: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/intern/kepek/list${targetPath ? `?p=${encodeURIComponent(targetPath)}` : ""}`,
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
  const folders = listing?.folders ?? [];
  const files = listing?.files ?? [];
  const imageCount = files.filter((f) => f.kind === "image").length;

  return (
    <div className="min-h-screen bg-background-dark">
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">
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
            Képek
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
            Képek
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

        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-neutral-100">
              {path ? breadcrumbs[breadcrumbs.length - 1]?.name ?? path : "Képek"}
            </h1>
            {listing && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {folders.length > 0 && `${folders.length} mappa · `}
                {files.length} fájl
                {imageCount > 0 && ` · ${imageCount} kép`}
              </p>
            )}
          </div>
          {listing?.zipUrl && (listing.files.length > 0 || listing.folders.length > 0) && (
            <a
              href={listing.zipUrl}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              aria-label="Mappa letöltése ZIP-ben (almappákkal együtt)"
            >
              <IconDownload className="size-3.5" />
              ZIP
            </a>
          )}
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
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {folders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => navigate(folder.path)}
                    className="group overflow-hidden rounded-xl border border-neutral-border bg-neutral-dark/50 text-left transition-colors hover:border-primary/50 hover:bg-neutral-dark"
                  >
                    <span className="relative block w-full" style={{ aspectRatio: "4 / 3" }}>
                      <span className="absolute inset-0 animate-pulse bg-[#143d14]/40" />
                      {folder.coverUrl ? (
                        <img
                          src={folder.coverUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center bg-[#0f2a1a]">
                          <FolderIcon className="size-7 text-neutral-600" />
                        </span>
                      )}
                      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    </span>
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-sm font-medium text-neutral-100">
                        {folder.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        {folder.imageCount} kép
                        {folder.fileCount > folder.imageCount
                          ? ` · ${folder.fileCount - folder.imageCount} egyéb`
                          : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {files.length > 0 && <KepekGallery files={files} />}

            {folders.length === 0 && files.length === 0 && (
              <p className="py-10 text-center text-sm text-neutral-600">
                Ez a mappa üres.
              </p>
            )}
          </>
        )}
      </main>

      <BottomNav active="none" />
    </div>
  );
}
