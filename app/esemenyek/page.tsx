import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import { IconCalendar, IconExternalLink } from "@/components/icons";
import { getUpcomingConcerts, type Concert } from "@/lib/upcoming-concerts";

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

const pastConcerts: Concert[] = [
  {
    date: "2025. október 12.",
    time: "19:00",
    location: "Budapest",
    venue: "MÜPA, Bartók Béla Nemzeti Hangversenyterem",
    title: "Összhang Gála",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus – 1. tétel (arr. Simon Cox)",
    ],
  },
  {
    date: "2025. május 15.",
    time: "19:00",
    location: "Budapest",
    venue: "Régi Zeneakadémia Kamara terem",
    title: "Kontrasztok/Színes lapok",
    program: [
      "W. A. Mozart – Sinfonia Concertante (Kv. 364) (arr. Szabó Benedek)",
    ],
    link: {
      label: "Zeneakadémia",
      href: "https://koncert.zeneakademia.hu/programok/2025-05-15-szines-lapok-13114",
    },
  },
  {
    date: "2025. május 7.",
    time: "19:00",
    location: "Budapest",
    venue: "Zeneakadémia Solti terem",
    title: "Szabó Benedek emlékkoncertje",
    program: [
      "Szabó Benedek – (Te)Réz Körút (Op.14)",
      "Szabó Benedek – Madman's Treasure (Op.2)",
    ],
    link: {
      label: "Zeneakadémia",
      href: "https://koncert.zeneakademia.hu/programok/event-13317",
    },
  },
  {
    date: "2025. április 29.",
    time: "19:00",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Baczkó Vince Bachelor diplomakoncertje",
    program: ["Szabó Benedek – Madman's Treasure (Op.2)"],
  },
  {
    date: "2025. április 10.",
    time: "16:00",
    location: "Budapest",
    venue: "Zeneakadémia Solti terem",
    title: "Faragó István MA diplomakoncertje",
    program: [
      "W. A. Mozart – Sinfonia Concertante (Kv. 364) (arr. Szabó Benedek)",
    ],
  },
  {
    date: "2025. március 9.",
    time: "16:00",
    location: "Budapest",
    venue: "Zeneakadémia Solti terem",
    title: "Klasszikusok vasárnap délután",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus (arr. Simon Cox)",
      "Szabó Benedek – (Te)Réz Körút (Op.14)",
    ],
    link: {
      label: "Zeneakadémia",
      href: "https://koncert.zeneakademia.hu/programok/2025-03-09-rez-korut-fuvos-szeptett-12952",
    },
  },
  {
    date: "2025. január 28.",
    time: "18:00",
    location: "Budapest XIII. kerületi",
    venue: "Fischer Annie Zeneiskola",
    title: "Bemutatkozik a Réz körút",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus (arr. Simon Cox)",
      "Szabó Benedek – (Te)Réz Körút (Op.14)",
      "W. A. Mozart – Sinfonia Concertante (Kv. 364) (arr. Szabó Benedek)",
      "Szabó Benedek – Madman's Treasure (Op.2)",
    ],
    link: {
      label: "Facebook esemény",
      href: "https://facebook.com/events/s/bemutatkozik-a-rez-korut-szept/1286592266001558/",
    },
  },
  {
    date: "2024. december 21.",
    location: "Budapest",
    venue: "Zeneakadémia Nagyterem",
    title: "Karácsonyi koncert a Zeneakadémián",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus (arr. Simon Cox)",
    ],
  },
  {
    date: "2024. május 8.",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Dénes András BA Diplomakoncertje",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus (arr. Simon Cox)",
    ],
  },
  {
    date: "2024. április 30.",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Kovács Márk BA Diplomakoncertje",
    program: ["Eric Whitacre – October (arr. Szabó Benedek)"],
  },
  {
    date: "2024. április 25.",
    location: "Budapest",
    venue: "Zeneakadémia Nagyterem",
    title: "Pusztaszegi Ákos MA Diplomakoncertje",
    program: [
      "Jean-Philippe Rameau – Suite from Dardanus (arr. Simon Cox)",
    ],
  },
  {
    date: "2023. április 20.",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Szabó Benedek BA Diplomakoncertje",
    program: ["Eric Whitacre – October (arr. Szabó Benedek)"],
  },
  {
    date: "2022. október 26.",
    location: "Budapest",
    venue: "Zeneakadémia Solti terem",
    title: "Rézfúvós hangszerek",
    program: ["Ránki Dezső – A hétfejű sárkány szerenádja"],
  },
];

function ConcertCard({ concert }: { concert: Concert }) {
  const cardClassName =
    "interactive-surface group rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/30 hover:bg-neutral-dark";

  const cardContent = (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold tracking-wider text-primary uppercase">
            {concert.date}
            {concert.time ? ` – ${concert.time}` : ""}
          </span>
          <span className="rounded-full bg-neutral-700/60 px-2 py-1 text-[11px] font-semibold tracking-wider text-neutral-300 uppercase">
            {concert.location}, {concert.venue}
          </span>
        </div>
        {concert.link && (
          <IconExternalLink
            className="size-4 text-primary transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
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
        <p className="mb-2 text-sm italic text-neutral-400">{concert.note}</p>
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
        className={`block ${cardClassName}`}
        data-proximity
        data-proximity-strength="2.1"
      >
        {cardContent}
      </a>
    );
  }

  return (
    <article
      className={cardClassName}
      data-proximity
      data-proximity-strength="2.1"
    >
      {cardContent}
    </article>
  );
}

export default async function EsemenyekPage() {
  const upcomingConcerts = await getUpcomingConcerts();
  // null = fetch error → hide section; [] = fetched but empty → hide section
  const displayedUpcoming = upcomingConcerts && upcomingConcerts.length > 0 ? upcomingConcerts : null;
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
                  {pastConcerts.map((concert) => (
                    <ConcertCard key={`${concert.date}-${concert.title}`} concert={concert} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
