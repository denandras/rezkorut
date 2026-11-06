"use client";

import { useCallback, useEffect, useState } from "react";
import { IconDownload, IconExternalLink } from "@/components/icons";
import type { KepekFile } from "@/lib/kepek";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function IconImagePlaceholder({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 15.75 5.159-5.257a3 3 0 0 1 4.311 0l5.18 5.26M3 19.5h18M3 19.5V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25V19.5"
      />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M7 4.5v15M17 4.5v15M2.5 12h19M2.5 8.2h4.5M2.5 15.8h4.5M17 8.2h4.5M17 15.8h4.5" />
    </svg>
  );
}

function Tile({
  file,
  index,
  onOpen,
}: {
  file: KepekFile;
  index: number;
  onOpen: (index: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState<string>("4 / 3");
  const isImage = file.kind === "image" && !!file.thumbUrl;

  return (
    <div className="mb-3 break-inside-avoid">
      <article className="group relative overflow-hidden rounded-xl border border-neutral-border bg-neutral-dark/40">
        <button
          type="button"
          onClick={() => onOpen(index)}
          className="block w-full cursor-pointer text-left"
          aria-label={`${file.name} megnyitása`}
        >
          <div className="relative w-full" style={{ aspectRatio: ratio }}>
            {isImage && !failed ? (
              <>
                {!loaded && (
                  <div className="absolute inset-0 animate-pulse bg-[#143d14]/40" />
                )}
                <img
                  src={file.thumbUrl}
                  alt={file.name}
                  loading="lazy"
                  decoding="async"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      setRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
                    }
                    setLoaded(true);
                  }}
                  onError={() => setFailed(true)}
                  className={`absolute inset-0 h-full w-full object-cover ${
                    loaded ? "gallery-img-reveal" : "opacity-0"
                  }`}
                />
              </>
            ) : file.kind === "video" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0f2a1a] text-neutral-500">
                <IconFilm className="size-8" />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#0f2a1a] text-neutral-600">
                <IconImagePlaceholder className="size-7" />
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                  {file.name.split(".").pop() ?? "fájl"}
                </span>
              </div>
            )}

            {file.kind === "video" && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-background-dark/70 text-primary ring-1 ring-primary/40 backdrop-blur-sm">
                  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5-11-6.5z" />
                  </svg>
                </span>
              </span>
            )}
          </div>
        </button>

        {file.downloadUrl && (
          <a
            href={file.downloadUrl}
            download
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2 inline-flex items-center justify-center rounded-lg border border-primary/30 bg-background-dark/75 p-2 text-primary backdrop-blur-sm transition-colors hover:bg-primary/20 hover:text-primary"
            aria-label="Letöltés"
            title="Letöltés"
          >
            <IconDownload className="size-3.5" />
          </a>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2 pt-8">
          <span className="truncate text-[11px] font-medium text-neutral-200">
            {file.name}
          </span>
          <span className="shrink-0 text-[10px] text-neutral-400">
            {formatSize(file.size)}
          </span>
        </div>
      </article>
    </div>
  );
}

export default function KepekGallery({ files }: { files: KepekFile[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (dir: 1 | -1) => {
      setOpenIndex((current) => {
        if (current === null || files.length === 0) return current;
        return (current + dir + files.length) % files.length;
      });
    },
    [files.length],
  );

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  const active = openIndex !== null ? files[openIndex] : null;

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-2 md:columns-3 xl:columns-4">
        {files.map((file, index) => (
          <Tile key={file.path} file={file} index={index} onOpen={setOpenIndex} />
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/92 backdrop-blur-sm"
          onClick={close}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-100">
                {active.name}
              </p>
              <p className="text-[11px] text-neutral-500">
                {formatSize(active.size)} · {openIndex! + 1} / {files.length}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {active.downloadUrl && (
                <a
                  href={active.downloadUrl}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  <IconDownload className="size-3.5" />
                  Letöltés
                </a>
              )}
              {active.viewUrl && (
                <a
                  href={active.viewUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-border px-3 py-2 text-xs text-neutral-300 transition-colors hover:text-neutral-100"
                  title="Eredeti megnyitása"
                >
                  <IconExternalLink className="size-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={close}
                className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-neutral-200 transition-colors hover:bg-white/20"
                aria-label="Bezárás"
              >
                ✕
              </button>
            </div>
          </div>

          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden px-2 pb-4 md:px-12"
            onClick={(e) => e.stopPropagation()}
          >
            {active.kind === "video" && active.viewUrl ? (
              <video
                key={active.key}
                src={active.viewUrl}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-lg"
              />
            ) : active.kind === "image" && (active.previewUrl || active.thumbUrl) ? (
              <img
                key={active.key}
                src={active.previewUrl ?? active.thumbUrl}
                alt={active.name}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-neutral-border bg-neutral-dark/70 px-6 py-10 text-center">
                <IconImagePlaceholder className="size-10 text-neutral-600" />
                <p className="text-sm text-neutral-200">{active.name}</p>
                <p className="text-xs text-neutral-500">
                  {active.name.split(".").pop()?.toUpperCase()} – böngészőben nem
                  jeleníthető meg. {formatSize(active.size)}
                </p>
                {active.downloadUrl && (
                  <a
                    href={active.downloadUrl}
                    download
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    <IconDownload className="size-3.5" />
                    Letöltés
                  </a>
                )}
              </div>
            )}

            {files.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(-1);
                  }}
                  className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                  aria-label="Előző"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(1);
                  }}
                  className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                  aria-label="Következő"
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
