"use client";

import { useEffect, useState } from "react";
import { IconDownload } from "@/components/icons";

type MediaItem = {
  id: string;
  viewUrl: string;
  downloadUrl: string;
};

type MediaGalleryProps = {
  items: MediaItem[];
  emptyMessage?: string;
};

/**
 * Calm progressive loading: every slot renders immediately as a static
 * placeholder (fixed aspect, no pulse/spinner). One persistent <img> per
 * tile crossfades over it on load — no remounts, no zoom, no layout jump
 * flash. Native loading="lazy" handles scroll-aware fetching. Plain <img>
 * (not next/image) so each tile is ONE origin URL, stable with the 7-day
 * pinned tokens, fully edge-cached.
 */
export default function MediaGallery({
  items,
  emptyMessage = "A galéria jelenleg üres.",
}: MediaGalleryProps) {
  const [loadedIds, setLoadedIds] = useState<Record<string, boolean>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [ratios, setRatios] = useState<Record<string, string>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Lightbox keyboard
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-border bg-neutral-dark/40 p-6 text-sm text-neutral-300">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      <div
        className="columns-1 gap-4 sm:columns-2 lg:columns-3"
      >
        {items.map((item, index) => {
          const isLoaded = !!loadedIds[item.id];
          const hasFailed = !!failedIds[item.id];
          const ratio = ratios[item.id] ?? "4 / 3";

          return (
            <div
              key={item.id}
              className="mb-4 break-inside-avoid"
            >
              <article
                className="group relative overflow-hidden rounded-xl border border-neutral-border bg-[#0f2a1a]"
                onClick={() => isLoaded && setLightboxSrc(item.viewUrl)}
                style={{ cursor: isLoaded ? "pointer" : "default" }}
              >
                {/* One persistent img over a static placeholder — crossfade
                    on load, no remount, no spinner, no pulse, no zoom. */}
                <div
                  className="relative w-full"
                  style={{ aspectRatio: ratio }}
                >
                  {hasFailed ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-sm text-neutral-500">Nem sikerült betölteni.</p>
                    </div>
                  ) : (
                    <img
                      src={item.viewUrl}
                      alt={`Réz körút – ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setRatios((prev) =>
                          img.naturalWidth > 0 && img.naturalHeight > 0
                            ? { ...prev, [item.id]: `${img.naturalWidth} / ${img.naturalHeight}` }
                            : prev,
                        );
                        setLoadedIds((prev) =>
                          prev[item.id] ? prev : { ...prev, [item.id]: true },
                        );
                      }}
                      onError={() =>
                        setFailedIds((prev) =>
                          prev[item.id] ? prev : { ...prev, [item.id]: true },
                        )
                      }
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out ${
                        isLoaded ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  )}
                  {isLoaded && (
                    <a
                      href={item.downloadUrl}
                      download
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-3 right-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-background-dark/70 px-2.5 py-2 text-xs font-semibold text-primary backdrop-blur-sm transition-all duration-200 hover:bg-background-dark/85 opacity-0 pointer-events-none md:group-hover:pointer-events-auto md:group-hover:opacity-100 max-md:opacity-100 max-md:pointer-events-auto"
                      aria-label="Letöltés"
                      title="Letöltés"
                    >
                      <IconDownload className="size-3.5" />
                    </a>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <div className="relative max-h-[90dvh] max-w-5xl w-full overflow-hidden rounded-xl">
            <img
              src={lightboxSrc}
              alt=""
              loading="eager"
              className="h-auto max-h-[90dvh] w-full object-contain"
              style={{ borderRadius: "0.75rem" }}
            />
          </div>
          <button
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            onClick={() => setLightboxSrc(null)}
            aria-label="Bezárás"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}