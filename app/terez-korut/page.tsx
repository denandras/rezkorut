import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import {
  IconSpotify,
  IconAppleMusic,
  IconDeezer,
  IconTidal,
} from "@/components/icons";
import BackToHomeLink from "@/components/back-to-home-link";

export const metadata: Metadata = {
  title: "Szabó Benedek – (Te)Réz körút – Réz körút",
  description:
    "Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.",
  openGraph: {
    title: "Szabó Benedek – (Te)Réz körút",
    description: "Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.",
    url: "https://rezkorut.hu/terez-korut",
    type: "music.album",
  },
  twitter: {
    card: "summary_large_image",
    title: "Szabó Benedek – (Te)Réz körút",
    description: "Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.",
  },
};

type PlatformLink = {
  kind: "spotify" | "apple-music" | "deezer" | "tidal";
  label: string;
  href: string;
};

const platforms: PlatformLink[] = [
  {
    kind: "spotify",
    label: "Meghallgatom Spotify-on",
    href: "https://open.spotify.com/album/6NHNHkieFvxGOOyEwuz9YP?si=LJ-qyQFBTeW9RkWmKVwgIQ",
  },
  {
    kind: "apple-music",
    label: "Irány az Apple Music",
    href: "https://music.apple.com/hu/album/te-r%C3%A9z-k%C3%B6r%C3%BAt/1848370488",
  },
  {
    kind: "deezer",
    label: "Deezer-en hallgatom",
    href: "https://link.deezer.com/s/31roFldFv9CTyMYReeYK2",
  },
  {
    kind: "tidal",
    label: "A Tidal megnyitása",
    href: "https://tidal.com/album/469100543/u",
  },
];

function PlatformIcon({ kind }: { kind: PlatformLink["kind"] }) {
  if (kind === "spotify") return <IconSpotify className="size-5" />;
  if (kind === "apple-music") return <IconAppleMusic className="size-5" />;
  if (kind === "deezer") return <IconDeezer className="size-5" />;
  return <IconTidal className="size-5" />;
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

export default function TerezKorutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <p className="font-display text-lg font-bold tracking-tight uppercase">(Te)Réz körút</p>
        </div>
      </header>

      <main className="flex-1 px-6 pb-28 pt-10 md:px-12 md:pt-14">
        <div className="mx-auto max-w-2xl">
          {/* Back link */}
          <BackToHomeLink
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-primary"
          />

          {/* Header */}
          <div className="mb-2">
            <p className="mb-1 text-xs font-bold tracking-widest text-primary uppercase">
              Kislemez · 2025
            </p>
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              Szabó Benedek
              <br />
              <span className="text-primary">(Te)Réz körút</span>
            </h1>
          </div>

          {/* Description */}
          <p className="mt-6 text-base leading-relaxed text-neutral-300 md:text-lg">
            Egy játékos, szatirikus utazás Budapest 4–6-os villamosának vonalán rézfúvós szeptettünktől.
            A mű szerzője, Szabó Benedek 2024-ben éppen október 28-án elhunyt tubásunk, barátunk;
            ezzel a felvétellel az ő képzelőereje és szíve előtt tisztelgünk.
            Hallgasd meg kedvenc zenemegosztó platformodon!
          </p>

          {/* YouTube embed */}
          <div className="mt-8 overflow-hidden rounded-2xl border border-neutral-border bg-neutral-dark/40">
            <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
              <iframe
                src="https://www.youtube.com/embed/WrrN445yFsw"
                title="Szabó Benedek – (Te)Réz körút"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          {/* Streaming links */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {platforms.map((p) => (
              <a
                key={p.href}
                href={p.href}
                target="_blank"
                rel="noreferrer"
                aria-label={p.label}
                title={p.label}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${platformAccent(p.kind)}`}
              >
                <PlatformIcon kind={p.kind} />
              </a>
            ))}
          </div>

          {/* Credits */}
          <p className="mt-8 text-center text-xs text-neutral-500">
            A hangfelvételt Kincses Péter, Gorszki Dániel, Dénes András készítették.
          </p>
        </div>
      </main>

      <BottomNav active="none" />
    </div>
  );
}
