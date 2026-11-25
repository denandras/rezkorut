import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import BuyForm from "@/components/tickets/BuyForm";
import { isoToHuDate } from "@/lib/concert-admin";
import { getPublicConcertTicketing } from "@/lib/tickets-public";
import { getUpcomingConcerts } from "@/lib/upcoming-concerts";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ concertId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { concertId } = await params;
  const ticketing = await getPublicConcertTicketing(concertId);
  return {
    title: ticketing?.title
      ? `Jegyvásárlás – ${ticketing.title} – Réz körút`
      : "Jegyvásárlás – Réz körút",
    description: "Jegyvásárlás a Réz körút koncertjeire.",
  };
}

export default async function JegyekPage({ params, searchParams }: PageProps) {
  const { concertId } = await params;
  const query = await searchParams;
  const canceled = query.canceled === "1";

  // Ticketing facts come from the public DB read; the S3 line is the source of
  // the program list (rk_concerts has no program column) and the header fallback.
  const [ticketing, upcoming] = await Promise.all([
    getPublicConcertTicketing(concertId),
    getUpcomingConcerts(),
  ]);
  const s3Concert = upcoming?.find((concert) => concert.id === concertId) ?? null;

  const title = ticketing?.title ?? s3Concert?.title ?? null;
  const dateHu = ticketing?.date ? isoToHuDate(ticketing.date) : s3Concert?.date ?? null;
  const time = ticketing?.time ?? s3Concert?.time ?? null;
  const venue = ticketing?.venue ?? s3Concert?.venue ?? null;
  const location = ticketing?.location ?? s3Concert?.location ?? null;
  const program = s3Concert?.program ?? null;

  const onSale = ticketing?.on_sale === true && ticketing.types.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">Jegyvásárlás</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 px-6 pb-24 pt-8 md:px-8">
        <div className="w-full">
          {title === null ? (
            <p className="text-sm text-neutral-300">Nincs ilyen koncert.</p>
          ) : (
            <>
              <section>
                <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                  {title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider text-primary uppercase">
                  {(dateHu || time) && (
                    <span className="rounded-full bg-primary/10 px-2 py-1">
                      {dateHu}
                      {time ? ` – ${time}` : ""}
                    </span>
                  )}
                  {(location || venue) && (
                    <span className="rounded-full bg-primary/10 px-2 py-1">
                      {venue ? `${location}, ${venue}` : location}
                    </span>
                  )}
                </div>

                {program && program.length > 0 && (
                  <ul className="mt-4 space-y-0.5">
                    {program.map((item) => (
                      <li key={item} className="text-sm text-neutral-400">
                        • {item}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canceled && (
                <p className="mt-6 text-sm text-neutral-300">
                  A fizetés megszakítva – a vásárlás nem történt meg, kártyaterhelés nem történt.
                </p>
              )}

              <section className="mt-8">
                {!ticketing || !ticketing.on_sale ? (
                  <p className="text-sm text-neutral-300">
                    A koncert jegyértékesítése jelenleg nincs folyamatban.
                  </p>
                ) : !onSale ? (
                  <p className="text-sm text-neutral-300">
                    Jelenleg nincs megvásárolható jegytípus.
                  </p>
                ) : (
                  <BuyForm concertId={concertId} types={ticketing.types} />
                )}
              </section>
            </>
          )}
        </div>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
