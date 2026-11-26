import Link from "next/link";
import AddToCalendarButton from "@/components/add-to-calendar-button";
import { IconExternalLink } from "@/components/icons";
import type { Concert } from "@/lib/upcoming-concerts";

/** Primary action, filled accent like every other primary button on the site. */
const TICKET_CTA_CLASS =
  "inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90";

export default function ConcertCard({
  concert,
  showCalendar = false,
}: {
  concert: Concert;
  showCalendar?: boolean;
}) {
  // Mobile: title row first (title + icon-only Naptárba right beside it), then
  // the details (badges, program) and the Jegyvásárlás CTA as the card's bottom
  // row. Desktop (md+): content left, Jegyvásárlás + Naptárba pill right.
  // Anchors never nest: the title is the link; the calendar button and the
  // Jegyvásárlás CTA are sibling <a>/<Link> elements, never inside the title.
  const cardClassName =
    "interactive-surface group flex flex-col gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/30 hover:bg-neutral-dark md:flex-row md:items-start md:justify-between";

  const ticketCta = concert.ticketUrl ? (
    <Link
      href={concert.ticketUrl}
      className={`${TICKET_CTA_CLASS} w-full md:w-auto`}
      aria-label={`Jegyvásárlás: ${concert.title}`}
    >
      Jegyvásárlás
    </Link>
  ) : null;

  const titleInner = (
    <>
      {concert.title}
      {concert.link && (
        <IconExternalLink
          className="ml-1.5 inline-block size-4 align-[-2px] text-neutral-300 group-hover:text-primary"
          aria-hidden="true"
        />
      )}
    </>
  );

  return (
    <article
      className={cardClassName}
      data-proximity
      data-proximity-strength="2.1"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display min-w-0 text-lg font-semibold leading-tight text-white">
            {concert.link ? (
              <a
                href={concert.link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${concert.title} – ${concert.link.label}`}
              >
                {titleInner}
              </a>
            ) : (
              titleInner
            )}
          </h3>
          {showCalendar && (
            <div className="shrink-0 md:hidden">
              <AddToCalendarButton concert={concert} />
            </div>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider text-primary uppercase">
          <span className="rounded-full bg-primary/10 px-2 py-1">
            {concert.date}
            {concert.time ? ` – ${concert.time}` : ""}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-1">
            {concert.venue ? `${concert.location}, ${concert.venue}` : concert.location}
          </span>
        </div>

        {concert.program && concert.program.length > 0 && (
          <ul className="mt-2 space-y-0.5">
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

      {/* Single CTA anchor, a direct child of the card: on mobile (flex-col)
          it is the full-width row at the bottom of the card, on desktop
          (flex-row) it sits in the right stack before the Naptárba pill.
          One anchor, never a title-nested one, never duplicated. */}
      {ticketCta}

      {showCalendar && (
        <div className="hidden shrink-0 md:block">
          <AddToCalendarButton concert={concert} />
        </div>
      )}
    </article>
  );
}