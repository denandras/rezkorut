"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type GalleryImage = {
  src: string;
  alt: string;
};

const images: GalleryImage[] = [
  { src: "/gallery/rezkorut_250309_013_szaloky_bela.jpg", alt: "Réz körút – 2025. március 9." },
  { src: "/gallery/rezkorut_250309_017_szaloky_bela.jpg", alt: "Réz körút – 2025. március 9." },
  { src: "/gallery/rezkorut_250309_033_szaloky_bela.jpg", alt: "Réz körút – 2025. március 9." },
  { src: "/gallery/rezkorut_250309_058_szaloky_bela.jpg", alt: "Réz körút – 2025. március 9." },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_8.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_9.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_10.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_11.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_12.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_16.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_34.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20250309_Rez_Korut_Fuvos_szeptett_Felvegi_Andrea_webes_40.jpg", alt: "Réz körút – 2025. március 9. (Felvégi Andrea)" },
  { src: "/gallery/20251012_200830-238.jpg", alt: "Réz körút – 2025. október 12." },
  { src: "/gallery/20251012_201452-254.jpg", alt: "Réz körút – 2025. október 12." },
  { src: "/gallery/20251012_201844-263.jpg", alt: "Réz körút – 2025. október 12." },
  { src: "/gallery/20251012_202851-286.jpg", alt: "Réz körút – 2025. október 12." },
  { src: "/gallery/ml_241202_013.jpg", alt: "Réz körút – 2024. december" },
  { src: "/gallery/ml_241202_018.jpg", alt: "Réz körút – 2024. december" },
  { src: "/gallery/ml_241202_022.jpg", alt: "Réz körút – 2024. december" },
  { src: "/gallery/ml_241202_032.jpg", alt: "Réz körút – 2024. december" },
  { src: "/gallery/ml_241202_036.jpg", alt: "Réz körút – 2024. december" },
  { src: "/gallery/20250309_145043.jpg", alt: "Réz körút – 2025. március 9." },
  { src: "/gallery/IMG_9905.jpg", alt: "Réz körút" },
  { src: "/gallery/2024_05_08-Diplomakoncert_fotos_038.jpg", alt: "Réz körút – 2024. Diplomakoncert" },
];

export default function MediaGallery() {
  const [loadedIds, setLoadedIds] = useState<Record<string, true>>({});
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
        if (!node.classList.contains("is-visible")) {
          observer.observe(node);
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  // Close lightbox on Escape
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
      <div
        ref={galleryRef}
        className="columns-1 gap-3 sm:columns-2 lg:columns-3"
      >
        {images.map((img, index) => {
          const isLoaded = !!loadedIds[img.src];
          const prioritized = index < 6;

          return (
            <div
              key={img.src}
              data-reveal
              style={{ "--reveal-delay": `${Math.min(index * 40, 400)}ms` } as React.CSSProperties}
              className="group mb-3 block cursor-pointer break-inside-avoid overflow-hidden rounded-lg bg-neutral-dark/40"
              onClick={() => setLightboxSrc(img.src)}
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <Image
                  src={img.src}
                  alt={img.alt}
                  fill
                  className={`object-cover transition-all duration-700 group-hover:scale-[1.03] ${
                    isLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  priority={prioritized}
                  onLoad={() => setLoadedIds((prev) => ({ ...prev, [img.src]: true }))}
                />
                {!isLoaded && (
                  <div className="absolute inset-0 animate-pulse bg-neutral-dark" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
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
