"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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
 * Image gallery with progressive background-image loading.
 *
 * Strategy:
 * 1. Server passes a list of items (already sorted fresh-to-old by lastModified).
 * 2. Client renders every slot immediately as a placeholder card with a fixed
 *    aspect ratio (no invisible/zero-height elements).
 * 3. A hidden <img> per item starts loading (browser handles priority/lazy).
 * 4. When the hidden img fires onLoad, we promote that image to "loaded" —
 *    the placeholder crossfades into the image with a fade-in animation.
 * 5. Scroll-position aware: images near viewport load first (IntersectionObserver
 *    triggers the actual <Image> fetch).
 */
export default function MediaGallery({
  items,
  emptyMessage = "A galéria jelenleg üres.",
}: MediaGalleryProps) {
  const [loadedIds, setLoadedIds] = useState<Record<string, boolean>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [visibleIds, setVisibleIds] = useState<Record<string, boolean>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  // Track which items have entered the viewport (for lazy loading trigger)
  useEffect(() => {
    if (!items.length) return;
    const root = galleryRef.current;
    if (!root) return;

    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-card-id]"));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-card-id");
            if (id) {
              setVisibleIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
            }
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "200px 0px", threshold: 0 },
    );

    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [items.length]);

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
        ref={galleryRef}
        className="columns-1 gap-4 sm:columns-2 lg:columns-3"
      >
        {items.map((item, index) => {
          const isLoaded = !!loadedIds[item.id];
          const hasFailed = !!failedIds[item.id];
          const isVisible = !!visibleIds[item.id] || index < 6;
          const prioritized = index < 6;

          return (
            <div
              key={item.id}
              data-card-id={item.id}
              className="mb-4 break-inside-avoid"
            >
              <article
                className="group relative overflow-hidden rounded-xl border border-neutral-border bg-neutral-dark/40"
                onClick={() => isLoaded && setLightboxSrc(item.viewUrl)}
                style={{ cursor: isLoaded ? "pointer" : "default" }}
              >
                {/* Placeholder — always visible, fixed aspect ratio */}
                {!isLoaded && !hasFailed && (
                  <div className="relative w-full" style={{ aspectRatio: "4 / 3" }}>
                    <div className="absolute inset-0 animate-pulse bg-[#143d14]/40" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {isVisible ? (
                        <svg
                          className="h-6 w-6 animate-spin text-primary/30"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-8 w-8 text-neutral-700"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m2.25 15.75 5.159-5.257a3 3 0 0 1 4.311 0l5.18 5.26M3 19.5h18M3 19.5V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25V19.5"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                )}

                {/* Failed state */}
                {hasFailed && (
                  <div
                    className="relative flex w-full items-center justify-center bg-neutral-dark/60"
                    style={{ aspectRatio: "4 / 3" }}
                  >
                    <p className="text-sm text-neutral-500">Nem sikerült betölteni.</p>
                  </div>
                )}

                {/* Hidden loader img — fires onLoad, then we promote */}
                {isVisible && !isLoaded && !hasFailed && (
                  <img
                    src={item.viewUrl}
                    alt=""
                    className="hidden"
                    onLoad={() =>
                      setLoadedIds((prev) =>
                        prev[item.id] ? prev : { ...prev, [item.id]: true },
                      )
                    }
                    onError={() =>
                      setFailedIds((prev) =>
                        prev[item.id] ? prev : { ...prev, [item.id]: true },
                      )
                    }
                  />
                )}

                {/* Loaded image — fade in */}
                {isLoaded && (
                  <>
                    <Image
                      src={item.viewUrl}
                      alt={`Réz körút – ${index + 1}`}
                      width={800}
                      height={600}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      quality={70}
                      loading={prioritized ? "eager" : "lazy"}
                      className="gallery-img-reveal block h-auto w-full object-cover"
                    />
                    {/* Download button */}
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
                  </>
                )}
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
            <Image
              src={lightboxSrc}
              alt=""
              width={1920}
              height={1080}
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