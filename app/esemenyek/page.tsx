import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import Link from "next/link";
import { IconCalendar, IconExternalLink } from "@/components/icons";

export const metadata: Metadata = {
  title: "Események – Réz körút",
  description: "A Réz körút rézfúvós szeptett koncertjei és fellépései.",
};

type Concert = {
  date: string;
  time?: string;
  location: string;
  venue: string;
  title: string;
  program?: string[];
  link?: { label: string; href: string };
  note?: string;
};

const upcomingConcerts: Concert[] = [
  {
    date: "2026. március 31.",
    time: "16:00",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Vida Mátyás BA diplomakoncertje",
    program: ["Eric Whitacre – October (arr. Szabó Benedek)"],
  },
  {
    date: "2026. április 15.",
    time: "19:30",
    location: "Budapest",
    venue: "Pesti Vigadó",
    title: "Rézfúvósünnep",
    program: ["Szabó Benedek – Madman's Treasure (Op.2)"],
  },
  {
    date: "2026. április 16.",
    time: "15:00",
    location: "Budapest",
    venue: "Régi Zeneakadémia",
    title: "Gulyás Buda és Nagy Sándor BA diplomakoncertje",
  },
  {
    date: "2026. április 30.",
    time: "18:00",
    location: "Budapest",
    venue: "Kiscelli Múzeum",
    title: "10 Years of EXILES | From Loss to Acceptance",
    program: ["Koprodukció Szende Natalie elektronikus zenei előadóval"],
    link: {
      label: "Jegyinfo",
      href: "https://www.jegy.hu/program/10-years-of-exiles-from-loss-to-acceptance-koncert-187897",
    },
  },
  {
    date: "2026. május 5.",
    time: "19:00",
    location: "Budapest",
    venue: "Zeneakadémia Nagyterem",
    title: "Dénes András MA diplomakoncertje",
    program: ["Sebestyén-Lázár Regina – Új mű"],
  },
];

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

function ConcertCard({ concert, upcoming = false }: { concert: Concert; upcoming?: boolean }) {
  return (
    <div className="border-b border-neutral-border pb-5 last:border-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold tracking-widest text-primary uppercase">
          {concert.date}
          {concert.time ? ` – ${concert.time}` : ""}
        </span>
        {upcoming && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
            közelgő
          </span>
        )}
      </div>
      <p className="mb-0.5 text-xs text-neutral-400">
        {concert.location}, {concert.venue}
      </p>
      <h3 className="font-display mb-2 text-base font-semibold">{concert.title}</h3>
      {concert.program && concert.program.length > 0 && (
        <ul className="mb-2 space-y-0.5">
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
      {concert.link && (
        <a
          href={concert.link.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
        >
          {concert.link.label}
          <IconExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

export default function EsemenyekPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <main className="flex-1 pb-24">
        <div className="px-6 pt-10 pb-6 md:px-12">
          <div className="mb-1 flex items-center gap-3">
            <div className="h-px w-8 bg-primary" />
            <span className="text-xs font-bold tracking-widest text-primary uppercase">
              Réz körút
            </span>
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            Események
          </h1>
        </div>

        {/* Upcoming */}
        <section className="px-6 pb-10 md:px-12">
          <div className="mb-5 flex items-center gap-3">
            <IconCalendar className="size-4 text-primary" />
            <h2 className="font-display text-lg font-bold tracking-tight">
              Közelgő koncertjeink
            </h2>
          </div>
          <div className="space-y-5">
            {upcomingConcerts.map((concert) => (
              <ConcertCard key={`${concert.date}-${concert.title}`} concert={concert} upcoming />
            ))}
          </div>
        </section>

        {/* Divider */}
        <div className="mx-6 mb-10 border-t border-neutral-border md:mx-12" />

        {/* Past */}
        <section className="px-6 pb-10 md:px-12">
          <h2 className="font-display mb-5 text-lg font-bold tracking-tight text-neutral-300">
            Múltbéli koncertjeink
          </h2>
          <div className="space-y-5">
            {pastConcerts.map((concert) => (
              <ConcertCard key={`${concert.date}-${concert.title}`} concert={concert} />
            ))}
          </div>
        </section>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
