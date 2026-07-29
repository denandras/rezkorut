"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import BottomNav from "@/components/bottom-nav";

const SESSION_KEY = "rezkorut-intern-auth";
const PASSWORD = process.env.NEXT_PUBLIC_INTERN_PASSWORD ?? "";

type MediaFile = {
  name: string;
  key: string;
  size: number;
  contentType: string;
  playable: boolean;
  viewUrl: string;
  downloadUrl: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(contentType: string) {
  if (contentType.startsWith("audio")) return "🎵";
  if (contentType.startsWith("video")) return "🎬";
  return "📄";
}

export default function MediaBrowserPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  // Browser state
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Player state
  const [playingFile, setPlayingFile] = useState<MediaFile | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // --- Auth (same pattern as other intern pages) ---
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") setAuthed(true);
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

  // --- Fetch folders ---
  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/intern/media/list");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setFolders(data.folders || []);
    } catch {
      setLoadError("Nem sikerült betölteni a mappákat.");
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Fetch files in a folder ---
  const fetchFiles = useCallback(async (folder: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/intern/media/list?folder=${encodeURIComponent(folder)}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setFiles(data.files || []);
    } catch {
      setLoadError("Nem sikerült betölteni a fájlokat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && !currentFolder) fetchFolders();
  }, [authed, currentFolder, fetchFolders]);

  // --- Navigation ---
  function openFolder(folder: string) {
    setCurrentFolder(folder);
    setFiles([]);
    fetchFiles(folder);
  }

  function goBack() {
    setCurrentFolder(null);
    setFiles([]);
    setPlayingFile(null);
  }

  // --- Player ---
  function playFile(file: MediaFile) {
    setPlayingFile(file);
  }

  function closePlayer() {
    setPlayingFile(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current = null;
    }
  }

  // Keyboard close player
  useEffect(() => {
    if (!playingFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlayer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playingFile]);

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
    <div className="min-h-screen bg-background-dark">
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 w-full">
        {/* Back link */}
        <div className="mb-4 flex items-center justify-between">
          <a
            href="/intern"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza az internhez
          </a>
          {currentFolder && (
            <button
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Vissza a mappákhoz
            </button>
          )}
        </div>

        {/* Header */}
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold text-neutral-100">
            {currentFolder ?? "Felvételek"}
          </h2>
          {!currentFolder && (
            <p className="mt-0.5 text-xs text-neutral-500">
              Réz körút felvételek a médiatárból
            </p>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16 text-neutral-500">
            <p className="text-sm">Betöltés…</p>
          </div>
        )}

        {/* Error */}
        {loadError && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {/* Folder list */}
        {!loading && !loadError && !currentFolder && (
          <div className="flex flex-col gap-2">
            {folders.length === 0 && (
              <p className="text-center text-sm text-neutral-600 py-8">
                Nincsenek felvételek.
              </p>
            )}
            {folders.map((folder) => (
              <button
                key={folder}
                onClick={() => openFolder(folder)}
                className="flex items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/60 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-neutral-dark"
              >
                <span className="text-lg shrink-0">📁</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-neutral-100 truncate">
                    {folder}
                  </span>
                </span>
                <svg className="w-4 h-4 shrink-0 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* File list */}
        {!loading && !loadError && currentFolder && (
          <div className="flex flex-col gap-2">
            {files.length === 0 && (
              <p className="text-center text-sm text-neutral-600 py-8">
                Nincsenek fájlok ebben a mappában.
              </p>
            )}
            {files.map((file) => (
              <div
                key={file.key}
                className="flex items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/60 px-4 py-3 transition-colors hover:border-neutral-500"
              >
                <span className="text-lg shrink-0">{fileIcon(file.contentType)}</span>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => file.playable && playFile(file)}
                    className={`block text-sm font-medium text-neutral-100 truncate text-left ${
                      file.playable ? "hover:text-primary cursor-pointer" : "cursor-default"
                    }`}
                    disabled={!file.playable}
                  >
                    {file.name}
                  </button>
                  <span className="text-xs text-neutral-500">
                    {formatSize(file.size)} · {file.contentType}
                  </span>
                </div>
                {file.playable && (
                  <button
                    onClick={() => playFile(file)}
                    className="shrink-0 rounded-lg bg-primary/20 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
                    aria-label="Lejátszás"
                  >
                    ▶
                  </button>
                )}
                <a
                  href={file.downloadUrl}
                  download
                  className="shrink-0 rounded-lg bg-neutral-700/40 px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-100 hover:bg-neutral-700/60"
                  aria-label="Letöltés"
                >
                  ⬇
                </a>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Player modal */}
      {playingFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={closePlayer}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-neutral-border bg-neutral-dark p-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-neutral-100 truncate pr-2">
                {playingFile.name}
              </span>
              <button
                onClick={closePlayer}
                className="shrink-0 rounded-lg bg-neutral-700/40 px-2 py-1 text-neutral-400 hover:text-neutral-100 transition-colors"
                aria-label="Bezárás"
              >
                ✕
              </button>
            </div>
            {playingFile.contentType.startsWith("audio") ? (
              <audio
                ref={audioRef}
                src={playingFile.viewUrl}
                controls
                autoPlay
                className="w-full"
              />
            ) : (
              <video
                ref={videoRef}
                src={playingFile.viewUrl}
                controls
                autoPlay
                playsInline
                className="w-full max-h-[70vh] rounded-lg"
              />
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
              <span>{formatSize(playingFile.size)}</span>
              <a
                href={playingFile.downloadUrl}
                download
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-border px-3 py-1.5 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 transition-colors"
              >
                ⬇ Letöltés
              </a>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="none" />
    </div>
  );
}