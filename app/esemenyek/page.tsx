import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import { IconCalendar, IconExternalLink } from "@/components/icons";
import { getUpcomingConcerts, getArchivedConcerts, type Concert } from "@/lib/upcoming-concerts";

export const metadata: Metadata = {
  title: "Események – Réz körút",
  description: "A Réz körút rézfúvós szeptett koncertjei és fellépései.",
  openGraph: {
    title: "Események – Réz körút",
    description: "A Réz körút rézfúvós szeptett koncertjei és fellépései.",
    url: "https://rezkorut.hu/esemenyek",
  },
  twitter: {
    card: "summary_large_image",
    title: "Események – Réz körút",
    description: "A Réz körút rézfúvós szeptett koncertjei és fellépései.",
  },
};

export const dynamic = "force-dynamic";

function ConcertCard({ concert }: { concert: Concert }) {
  const cardClassName =
    "interactive-surface group flex items-start justify-between gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/30 hover:bg-neutral-dark";

  const cardContent = (
    <>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider text-primary uppercase">
          <span className="rounded-full bg-primary/10 px-2 py-1">
            {concert.date}
            {concert.time ? ` – ${concert.time}` : ""}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-1">
            {concert.location}, {concert.venue}
          </span>
        </div>
        <h3 className="font-display text-lg font-semibold leading-tight text-white">{concert.title}</h3>
        {concert.program && concert.program.length > 0 && (
          <ul className="mt-2 mb-2 space-y-0.5">
            {concert.program.map((item) => (
              <li key={item} className="text-sm text-neutral-400">
                • {item}
              </li>
            ))}
          </ul>
        )}
        {concert.note && (
          <p className="mt-2 text-sm text-neutral-300">{concert.note}</p>
        )}
      </div>
      {concert.link && (
        <IconExternalLink
          className="mt-0.5 size-5 shrink-0 text-neutral-300 transition-colors group-hover:text-primary"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (concert.link) {
    return (
      <a
        href={concert.link.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${concert.title} – ${concert.link.label}`}
        className={cardClassName}
        data-proximity
        data-proximity-strength="2.1"
      >
        {cardContent}
      </a>
    );
  }

  return (
    <article className={cardClassName}>
      {cardContent}
    </article>
  );
}

export default async function EsemenyekPage() {
  const [upcomingConcerts, archivedConcerts] = await Promise.all([
    getUpcomingConcerts(),
    getArchivedConcerts(),
  ]);
  // null = fetch error → hide section; [] = fetched but empty → hide section
  const displayedUpcoming = upcomingConcerts && upcomingConcerts.length > 0 ? upcomingConcerts : null;
  const displayedArchived = archivedConcerts && archivedConcerts.length > 0 ? archivedConcerts : null;
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">Események</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 pb-24">
        <div className="w-full px-6 py-8 md:px-8">
          <section className="pt-8">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                Koncertjeink
              </h2>
            </div>

            {displayedUpcoming && (
              <div className="relative grid gap-6 py-2 md:grid-cols-12 md:gap-8">
                <h3 className="pointer-events-none absolute top-2 right-1 z-0 hidden max-w-[92%] text-right font-display text-6xl leading-[0.85] font-bold tracking-tight text-white/60 uppercase md:block lg:text-7xl">
                  Közelgő
                </h3>
                <div className="md:order-2 md:col-span-4 md:text-right">
                  <h3 className="font-display text-4xl leading-[0.88] font-bold tracking-tight text-white uppercase md:hidden">
                    Közelgő
                  </h3>
                </div>
                <div className="relative md:order-1 md:col-span-8">
                  <div className="relative z-10 space-y-3 md:pt-10">
                    {displayedUpcoming.map((concert) => (
                      <ConcertCard key={`${concert.date}-${concert.title}`} concert={concert} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {displayedArchived && (
            <section className="mt-6 border-t border-neutral-border/80">
              <div className="relative grid gap-6 py-10 md:grid-cols-12 md:gap-8">
                <h3 className="pointer-events-none absolute top-11 left-1 z-0 hidden max-w-[92%] font-display text-6xl leading-[0.85] font-bold tracking-tight text-white/60 uppercase md:block lg:text-7xl">
                  Archív
                </h3>
                <div className="md:col-span-4">
                  <h3 className="font-display text-4xl leading-[0.88] font-bold tracking-tight text-white uppercase md:hidden">
                    Archív
                  </h3>
                </div>
                <div className="relative md:col-span-8">
                  <div className="relative z-10 space-y-3 md:pt-10">
                    {displayedArchived.map((concert) => (
                      <ConcertCard key={`${concert.date}-${concert.title}`} concert={concert} />
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
