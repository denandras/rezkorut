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

export default function MediaGallery({
  items,
  emptyMessage = "A galéria jelenleg üres.",
}: MediaGalleryProps) {
  const resolved = items;
  const [loadedIds, setLoadedIds] = useState<Record<string, true>>({});
  const [failedIds, setFailedIds] = useState<Record<string, true>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = galleryRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    const raf = window.requestAnimationFrame(() => {
      nodes.forEach((node) => {
        if (!node.classList.contains("is-visible")) observer.observe(node);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [resolved.length]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  return (
    <>
      {resolved.length === 0 && (
        <div className="rounded-xl border border-neutral-border bg-neutral-dark/40 p-6 text-sm text-neutral-300">
          {emptyMessage}
        </div>
      )}
      <div
        ref={galleryRef}
        className="columns-1 gap-4 sm:columns-2 lg:columns-3"
      >
        {resolved.map((item, index) => {
          const isLoaded = !!loadedIds[item.id];
          const hasFailed = !!failedIds[item.id];
          const downloadVisibilityClass = isLoaded
            ? "opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:pointer-events-auto md:group-hover:opacity-100"
            : "opacity-0 pointer-events-none";
          const prioritized = index < 6;

          return (
            <div
              key={item.id}
              className="mb-4 break-inside-avoid"
              data-reveal
              style={{ "--reveal-delay": `${80 + (index % 12) * 55}ms` } as React.CSSProperties}
            >
              <article
                className={`interactive-surface group relative cursor-pointer overflow-hidden rounded-xl transition-all ${
                  isLoaded
                    ? "border border-neutral-border bg-neutral-dark/40 hover:border-primary/30 hover:bg-neutral-dark"
                    : "border border-transparent bg-transparent"
                }`}
                data-proximity
                data-proximity-strength="2.1"
                onClick={() => isLoaded && setLightboxSrc(item.viewUrl)}
              >
                {!isLoaded && (
                  <div className="absolute inset-0 animate-pulse bg-neutral-dark/70" />
                )}

                <Image
                  src={item.viewUrl}
                  alt={`Réz körút – ${index + 1}`}
                  width={1600}
                  height={1200}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  loading={prioritized ? "eager" : "lazy"}
                  fetchPriority={prioritized ? "high" : "auto"}
                  onLoad={() =>
                    setLoadedIds((prev) =>
                      prev[item.id] ? prev : { ...prev, [item.id]: true },
                    )
                  }
                  onError={() => {
                    setFailedIds((prev) =>
                      prev[item.id] ? prev : { ...prev, [item.id]: true },
                    );
                    setLoadedIds((prev) =>
                      prev[item.id] ? prev : { ...prev, [item.id]: true },
                    );
                  }}
                  className={`block h-auto w-full object-cover transition-opacity duration-300 ${
                    isLoaded ? "opacity-100" : "opacity-0"
                  }`}
                />

                {hasFailed && (
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-dark/85 p-4 text-center">
                    <p className="text-sm text-neutral-400">Nem sikerült betölteni.</p>
                  </div>
                )}

                {!hasFailed && (
                  <a
                    href={item.downloadUrl}
                    download
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute top-3 right-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-background-dark/70 px-2.5 py-2 text-xs font-semibold text-primary backdrop-blur-sm transition-all duration-200 hover:bg-background-dark/85 ${downloadVisibilityClass}`}
                    aria-label="Letöltés"
                    title="Letöltés"
                  >
                    <IconDownload className="size-3.5" />
                  </a>
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
