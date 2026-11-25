"use client";

import StatusPill, { pillState } from "./StatusPill";
import StatBar from "./StatBar";
import type { ApiConcert } from "./types";

/**
 * Every upcoming concert from the S3 file, in file order. A row shows
 * date + time, title, venue, the status pill and the sold/capacity stat bar;
 * concerts with ticketing open the detail page, concerts without show the
 * „Jegyértékesítés indítása” action (the detail page is where types are
 * created and sales are published).
 */
export default function ConcertList({
  concerts,
  onEdit,
}: {
  concerts: ApiConcert[];
  onEdit: (concert: ApiConcert) => void;
}) {
  if (concerts.length === 0) {
    return (
      <p className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4 text-sm text-neutral-400">
        Nincs közelgő koncert a fájlban.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {concerts.map((concert) => {
        const state = pillState(concert.ticketing);
        const detailHref = concert.id ? `/intern/koncertek/${concert.id}` : null;
        const sold = concert.ticketing?.sold ?? 0;
        const capacity = concert.ticketing?.capacity ?? null;
        const place = [concert.location, concert.venue].filter((part) => part).join(", ");

        return (
          <article
            key={concert.id ?? `${concert.date}-${concert.title}`}
            className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-primary">
                {concert.date}
                {concert.time ? ` – ${concert.time}` : ""}
              </p>
              <StatusPill state={state} />
            </div>

            <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div className="min-w-0">
                {detailHref ? (
                  <a
                    href={detailHref}
                    className="font-display text-base font-semibold text-neutral-100 transition-colors hover:text-primary"
                  >
                    {concert.title}
                  </a>
                ) : (
                  <h3 className="font-display text-base font-semibold text-neutral-100">
                    {concert.title}
                  </h3>
                )}
                {place && <p className="mt-0.5 text-xs text-neutral-400">{place}</p>}
              </div>
              {concert.ticketing && (
                <div className="sm:w-48 sm:shrink-0 sm:grow-0">
                  <StatBar sold={sold} capacity={capacity} />
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {detailHref ? (
                state === "none" ? (
                  <a
                    href={detailHref}
                    className="text-sm font-semibold text-primary underline-offset-2 transition-opacity hover:opacity-70"
                  >
                    Jegyértékesítés indítása
                  </a>
                ) : (
                  <a
                    href={detailHref}
                    className="text-sm font-semibold text-primary underline-offset-2 transition-opacity hover:opacity-70"
                  >
                    Részletek
                  </a>
                )
              ) : (
                <span className="text-xs text-neutral-500">
                  A koncertnek még nincs azonosítója – szerkesztéssel kaphat egyet.
                </span>
              )}
              <button
                type="button"
                onClick={() => onEdit(concert)}
                className="text-sm text-neutral-400 transition-colors hover:text-primary"
              >
                Szerkesztés
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
