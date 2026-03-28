"use client";

import BottomNav from "@/components/bottom-nav";
import { useEffect, useRef, useState } from "react";
import {
  IconArrowForward,
  IconInstagram,
  IconYouTube,
  IconFacebook,
  IconExternalLink,
} from "@/components/icons";
import Link from "next/link";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function HomePage() {
  const heroRef = useRef<HTMLElement | null>(null);
  const [headerProgress, setHeaderProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const heroHeight =
        heroRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.8);
      const start = Math.max(24, heroHeight - 220);
      const end = Math.max(start + 1, heroHeight - 120);
      const progress = clamp(
        (window.scrollY - start) / (end - start),
        0,
        1,
      );
      setHeaderProgress(progress);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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
      {/* Sticky header fades in on scroll */}
      <header
        className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between border-b border-neutral-border bg-background-dark/80 px-6 py-3 backdrop-blur-md"
        style={{
          opacity: headerProgress,
          transform: `translateY(${Math.round((1 - headerProgress) * -14)}px)`,
          pointerEvents: headerProgress > 0.08 ? "auto" : "none",
        }}
      >
        <span className="font-display text-lg font-bold tracking-tight uppercase text-primary">
          Réz körút
        </span>
        <span className="font-display text-xs font-semibold tracking-[0.18em] text-neutral-400 uppercase">
          Rézfúvós szeptett
        </span>
      </header>

      <main className="flex-1 pb-24">
        {/* Hero */}
        <section
          ref={heroRef}
          className="relative flex min-h-[72dvh] w-full flex-col justify-end overflow-hidden"
        >
          {/* Atmospheric gradient backdrop */}
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-dark via-background-dark to-background-dark" />
          {/* Copper glow accent */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 30% 60%, rgba(196,120,64,0.22) 0%, transparent 70%)",
            }}
          />

          <div className="relative z-10 px-6 pb-14 md:px-12">
            <div
              data-reveal
              style={
                {
                  "--reveal-delay": "60ms",
                  top: `${Math.round(headerProgress * -22)}px`,
                  opacity: 1 - headerProgress * 0.35,
                } as React.CSSProperties
              }
              className="relative"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px w-10 bg-primary" />
                <p className="font-display text-xs font-semibold tracking-[0.22em] text-primary uppercase">
                  Rézfúvós szeptett
                </p>
              </div>
              <h1 className="font-display mb-4 text-6xl font-bold leading-none tracking-tighter text-white md:text-8xl">
                Réz körút
              </h1>
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
            {/* (Te)Réz körút */}
            <div
              data-reveal
              style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
            >
              <a
                href="https://open.spotify.com/album/6NHNHkieFvxGOOyEwuz9YP?si=LJ-qyQFBTeW9RkWmKVwgIQ"
                target="_blank"
                rel="noreferrer"
                className="interactive-surface group block rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/40 hover:bg-neutral-dark"
                data-proximity
                data-proximity-strength="2.1"
              >
                <p className="mb-1 text-xs font-bold tracking-widest text-primary uppercase">
                  Legújabb lemezünk
                </p>
                <h3 className="font-display mb-1 text-xl font-semibold">
                  Szabó Benedek – (Te)Réz körút
                </h3>
                <p className="mb-3 text-sm text-neutral-300">
                  Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="https://open.spotify.com/album/6NHNHkieFvxGOOyEwuz9YP?si=LJ-qyQFBTeW9RkWmKVwgIQ"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
                  >
                    Spotify
                    <IconExternalLink className="size-3" />
                  </a>
                  <a
                    href="https://music.apple.com/hu/album/te-r%C3%A9z-k%C3%B6r%C3%BAt/1848370488"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
                  >
                    Apple Music
                    <IconExternalLink className="size-3" />
                  </a>
                  <a
                    href="https://link.deezer.com/s/31roFldFv9CTyMYReeYK2"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
                  >
                    Deezer
                    <IconExternalLink className="size-3" />
                  </a>
                  <a
                    href="https://tidal.com/album/469100543/u"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
                  >
                    Tidal
                    <IconExternalLink className="size-3" />
                  </a>
                </div>
              </a>
            </div>

            {/* Madman's Treasure */}
            <div
              data-reveal
              style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
            >
              <div
                className="interactive-surface group block rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/40 hover:bg-neutral-dark"
                data-proximity
                data-proximity-strength="2.1"
              >
                <p className="mb-1 text-xs font-bold tracking-widest text-primary uppercase">
                  Videó
                </p>
                <h3 className="font-display mb-1 text-xl font-semibold">
                  Szabó Benedek – Madman's Treasure
                </h3>
                <p className="mb-3 text-sm text-neutral-300">
                  Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.
                  A mű szerzője Szabó Benedek, 2024-ben éppen október 28-án elhunyt tubásunk, barátunk;
                  ezzel a felvétellel az ő képzelőereje, és szíve előtt tisztelgünk.
                  Elérhető minden zenemegosztó platformon.
                </p>
                <a
                  href="https://youtu.be/WrrN445yFsw"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
                >
                  <IconYouTube className="size-3.5" />
                  Megnézem YouTube-on
                  <IconArrowForward className="size-3" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Quick links */}
        <section className="px-6 pb-4 md:px-12">
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            data-reveal
          >
            <Link
              href="/esemenyek"
              className="interactive-surface flex items-center justify-between rounded-xl border border-neutral-border bg-neutral-dark/30 px-4 py-4 transition-all hover:border-primary/30 hover:bg-neutral-dark"
              data-proximity
            >
              <span className="font-display text-sm font-semibold">Események</span>
              <IconArrowForward className="size-4 text-primary" />
            </Link>
            <Link
              href="/media"
              className="interactive-surface flex items-center justify-between rounded-xl border border-neutral-border bg-neutral-dark/30 px-4 py-4 transition-all hover:border-primary/30 hover:bg-neutral-dark"
              data-proximity
            >
              <span className="font-display text-sm font-semibold">Média</span>
              <IconArrowForward className="size-4 text-primary" />
            </Link>
            <Link
              href="/rolunk"
              className="interactive-surface col-span-2 flex items-center justify-between rounded-xl border border-neutral-border bg-neutral-dark/30 px-4 py-4 transition-all hover:border-primary/30 hover:bg-neutral-dark sm:col-span-1"
              data-proximity
            >
              <span className="font-display text-sm font-semibold">Rólunk</span>
              <IconArrowForward className="size-4 text-primary" />
            </Link>
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
              href="mailto:mail@rezkorut.hu"
              className="text-sm text-neutral-400 transition-colors hover:text-primary"
            >
              mail@rezkorut.hu
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
