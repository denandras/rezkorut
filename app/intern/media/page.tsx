"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import BottomNav from "@/components/bottom-nav";
import { INTERN_PASSWORD, getInternAuth, setInternAuth } from "@/lib/intern-auth";
import { InternTitle } from "@/components/intern-title";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDocs,
  IconDownload,
  IconFolder,
  IconMusicNote,
  IconPlay,
  IconVideo,
} from "@/components/icons";

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

function FileTypeIcon({ contentType, className }: { contentType: string; className?: string }) {
  if (contentType.startsWith("audio")) return <IconMusicNote className={className} />;
  if (contentType.startsWith("video")) return <IconVideo className={className} />;
  return <IconDocs className={className} />;
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
    if (getInternAuth()) setAuthed(true);
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
    <div className="min-h-screen bg-background-dark">
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 w-full">
        {/* Back link */}
        <div className="mb-4 flex items-center justify-between">
          {currentFolder && (
            <button
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary transition-colors"
            >
              <IconChevronLeft className="size-3.5" />
              Vissza a mappákhoz
            </button>
          )}
          <a
            href="/intern"
            className={`inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary transition-colors ${currentFolder ? "ml-auto" : ""}`}
          >
            <IconChevronLeft className="size-3.5" />
            Vissza az internhez
          </a>
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

        {/* Folder list — one row per folder, on every screen size */}
        {!loading && !loadError && !currentFolder && (
          <ul className="flex flex-col gap-1.5">
            {folders.length === 0 && (
              <li className="py-8 text-center text-[13px] text-neutral-600">Nincsenek felvételek.</li>
            )}
            {folders.map((folder) => (
              <li key={folder}>
                <button
                  onClick={() => openFolder(folder)}
                  className="flex w-full items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/50 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-neutral-dark"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/[0.10] text-primary">
                    <IconFolder className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-neutral-100">{folder}</span>
                  <IconChevronRight className="size-4 shrink-0 text-neutral-600" />
                </button>
              </li>
            ))}
          </ul>
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
                className="flex items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/50 px-3 py-2.5 transition-colors hover:border-primary/40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/[0.10] text-primary">
                  <FileTypeIcon contentType={file.contentType} className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => file.playable && playFile(file)}
                    className={`block w-full truncate text-left text-[14px] font-medium text-neutral-100 ${
                      file.playable ? "cursor-pointer hover:text-primary" : "cursor-default"
                    }`}
                    disabled={!file.playable}
                  >
                    {file.name}
                  </button>
                  <span className="text-[11.5px] text-neutral-500">
                    {formatSize(file.size)} · {file.contentType}
                  </span>
                </div>
                {file.playable && (
                  <button
                    onClick={() => playFile(file)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25"
                    aria-label={`${file.name} lejátszása`}
                  >
                    <IconPlay className="size-4" />
                  </button>
                )}
                <a
                  href={file.downloadUrl}
                  download
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-border text-neutral-400 transition-colors hover:border-primary/40 hover:text-primary"
                  aria-label={`${file.name} letöltése`}
                >
                  <IconDownload className="size-4" />
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
                <IconClose className="size-4" />
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
                <IconDownload className="size-3.5" /> Letöltés
              </a>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="none" />
    </div>
  );
}