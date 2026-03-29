"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/bottom-nav";
import { useEffect, useRef } from "react";
import {
  IconInstagram,
  IconYouTube,
  IconFacebook,
  IconSpotify,
  IconAppleMusic,
  IconDeezer,
  IconTidal,
} from "@/components/icons";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type PlatformLink = {
  kind: "spotify" | "apple-music" | "deezer" | "tidal";
  label: string;
  href: string;
};

type Release = {
  badge: string;
  title: string;
  description: string;
  detailHref: string;
  platforms: PlatformLink[];
};

const terezPlatforms: PlatformLink[] = [
  {
    kind: "spotify",
    label: "Spotify",
    href: "https://open.spotify.com/album/6NHNHkieFvxGOOyEwuz9YP?si=LJ-qyQFBTeW9RkWmKVwgIQ",
  },
  {
    kind: "apple-music",
    label: "Apple Music",
    href: "https://music.apple.com/hu/album/te-r%C3%A9z-k%C3%B6r%C3%BAt/1848370488",
  },
  {
    kind: "deezer",
    label: "Deezer",
    href: "https://link.deezer.com/s/31roFldFv9CTyMYReeYK2",
  },
  {
    kind: "tidal",
    label: "Tidal",
    href: "https://tidal.com/album/469100543/u",
  },
];

const madmanPlatforms: PlatformLink[] = [
  {
    kind: "spotify",
    label: "Spotify",
    href: "https://open.spotify.com/search/Madman's%20Treasure%20Szab%C3%B3%20Benedek",
  },
  {
    kind: "deezer",
    label: "Deezer",
    href: "https://link.deezer.com/s/32PR1xWdio8vHcy2RWQei",
  },
  {
    kind: "tidal",
    label: "Tidal",
    href: "https://tidal.com/album/507948509/u",
  },
];

function PlatformIcon({ kind }: { kind: PlatformLink["kind"] }) {
  if (kind === "spotify") return <IconSpotify className="size-4" />;
  if (kind === "apple-music") return <IconAppleMusic className="size-4" />;
  if (kind === "deezer") return <IconDeezer className="size-4" />;
  return <IconTidal className="size-4" />;
}

function platformAccent(kind: PlatformLink["kind"]) {
  if (kind === "spotify") {
    return "text-[#1ED760] border-[#1ED760]/60 bg-[#1ED760]/10 hover:bg-[#1ED760]/20";
  }
  if (kind === "apple-music") {
    return "text-[#FC3C44] border-[#FC3C44]/60 bg-[#FC3C44]/10 hover:bg-[#FC3C44]/20";
  }
  if (kind === "deezer") {
    return "text-[#A238FF] border-[#A238FF]/60 bg-[#A238FF]/10 hover:bg-[#A238FF]/20";
  }
  return "text-[#00FFFF] border-[#00FFFF]/60 bg-[#00FFFF]/10 hover:bg-[#00FFFF]/20";
}

const releases: Release[] = [
  {
    badge: "Kislemez",
    title: "Szabó Benedek – Madman's Treasure",
    description:
      "A mű szerzője Szabó Benedek, 2024-ben éppen október 28-án elhunyt tubásunk, barátunk; ezzel a felvétellel az ő képzelőereje és szíve előtt tisztelgünk.",
    detailHref: "/madmans-treasure",
    platforms: madmanPlatforms,
  },
  {
    badge: "Kislemez",
    title: "Szabó Benedek – (Te)Réz körút",
    description:
      "Egy játékos, szatirikus utazás Budapest 4-6-os villamosának vonalán rézfúvós szeptettünktől.",
    detailHref: "/terez-korut",
    platforms: terezPlatforms,
  },
];

export default function HomePage() {
  const router = useRouter();
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
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
      nodes.forEach((node) => observer.observe(node));
    });

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <main className="flex-1 pb-24">
        {/* Hero */}
        <section
          ref={heroRef}
          className="relative flex w-full flex-col justify-end overflow-hidden"
          style={{ aspectRatio: "2048 / 1365", maxHeight: "88dvh", minHeight: "max(82dvh, 320px)" }}
        >
          {/* Hero image */}
          <div
            className="absolute inset-0"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 86%, rgba(0,0,0,0.35) 95%, rgba(0,0,0,0) 100%)",
              maskImage:
                "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 86%, rgba(0,0,0,0.35) 95%, rgba(0,0,0,0) 100%)",
            }}
          >
            <Image
              src="/hero.jpg"
              alt="Réz körút"
              fill
              priority
              sizes="100vw"
              className="object-cover object-center"
            />
          </div>
          {/* Dark overlay: keep image center clearer, start fade lower */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(11,26,16,0.9) 0%, rgba(11,26,16,0.88) 18%, rgba(11,26,16,0.62) 34%, rgba(11,26,16,0.28) 50%, rgba(11,26,16,0.1) 63%, rgba(11,26,16,0.02) 76%, rgba(11,26,16,0) 100%)",
            }}
          />
          {/* Champagne glow */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 30% 60%, rgba(230,213,163,0.3) 0%, transparent 70%)",
            }}
          />

          <div className="relative z-10 px-6 pb-14 md:px-12">
            <div
              data-reveal
              style={
                {
                  "--reveal-delay": "60ms",
                } as React.CSSProperties
              }
              className="relative"
            >
              <h1 className="font-display mb-4 text-6xl font-bold leading-none tracking-tighter text-white md:text-8xl">
                Réz körút
              </h1>
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px w-10 bg-primary" />
                <p className="font-display text-xs font-bold tracking-[0.22em] text-primary uppercase md:text-sm">
                  Rézfúvós szeptett
                </p>
              </div>
              <p
                className="font-display text-2xl font-light italic text-neutral-300 md:text-3xl"
                data-reveal
                style={{ "--reveal-delay": "180ms" } as React.CSSProperties}
              >
                Megállítjuk az időt.
              </p>
            </div>
          </div>
        </section>

        {/* Latest releases */}
        <section className="px-6 py-12 md:px-12">
          <div className="mb-8" data-reveal>
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Legújabb kiadásaink
            </h2>
          </div>

          <div className="space-y-4">
            {releases.map((release, index) => (
              <article
                key={release.title}
                data-reveal
                style={{
                  "--reveal-delay": `${80 + index * 80}ms`,
                } as React.CSSProperties}
                className="interactive-surface cursor-pointer rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/40 hover:bg-neutral-dark"
                data-proximity
                data-proximity-strength="2.1"
                role="link"
                tabIndex={0}
                aria-label={`${release.title} részletei`}
                onClick={() => router.push(release.detailHref)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(release.detailHref);
                  }
                }}
              >
                <p className="mb-1 text-xs font-bold tracking-widest text-primary uppercase">
                  {release.badge}
                </p>
                <h3 className="font-display mb-2 text-xl font-semibold">{release.title}</h3>
                <p className="mb-4 text-sm text-neutral-300">{release.description}</p>

                <div className="flex items-center gap-2">
                  {release.platforms.map((platform) => (
                    <a
                      key={`${release.title}-${platform.label}`}
                      href={platform.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={platform.label}
                      title={platform.label}
                      onClick={(event) => event.stopPropagation()}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${platformAccent(platform.kind)}`}
                    >
                      <PlatformIcon kind={platform.kind} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-neutral-border px-6 py-8 md:px-12">
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <a
              href="https://instagram.com/rezkorut"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="text-neutral-400 transition-colors hover:text-primary"
            >
              <IconInstagram className="size-5" />
            </a>
            <a
              href="https://youtube.com/@rezkorut"
              target="_blank"
              rel="noreferrer"
              aria-label="YouTube"
              className="text-neutral-400 transition-colors hover:text-primary"
            >
              <IconYouTube className="size-5" />
            </a>
            <a
              href="https://facebook.com/people/R%C3%A9z-k%C3%B6r%C3%BAt/61571890856498"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className="text-neutral-400 transition-colors hover:text-primary"
            >
              <IconFacebook className="size-5" />
            </a>
            <a
              href="mailto:rezkorut@gmail.com"
              className="text-sm text-neutral-400 transition-colors hover:text-primary"
            >
              rezkorut@gmail.com
            </a>
          </div>
          <p className="text-xs text-neutral-500">
            Réz körút © {new Date().getFullYear()} • Rézfúvós szeptett portfólió • Budapest, Magyarország
          </p>
        </footer>
      </main>

      <BottomNav active="home" />
    </div>
  );
}
