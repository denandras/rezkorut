import AddToCalendarButton from "@/components/add-to-calendar-button";
import { IconExternalLink } from "@/components/icons";
import type { Concert } from "@/lib/upcoming-concerts";

export default function ConcertCard({
  concert,
  showCalendar = false,
}: {
  concert: Concert;
  showCalendar?: boolean;
}) {
  // Mobile: content stacks over an actions row (no side column — text keeps full width).
  // Desktop (md+): text left, Naptárba pill right — same as the pre-2026-10-11 card.
  const cardClassName =
    "interactive-surface group flex flex-col gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-5 transition-all hover:border-primary/30 hover:bg-neutral-dark md:flex-row md:items-start md:justify-between";

  const inner = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider text-primary uppercase">
        <span className="rounded-full bg-primary/10 px-2 py-1">
          {concert.date}
          {concert.time ? ` – ${concert.time}` : ""}
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-1">
          {concert.venue ? `${concert.location}, ${concert.venue}` : concert.location}
        </span>
      </div>
      <h3 className="font-display text-lg font-semibold leading-tight text-white">
        {concert.title}
        {concert.link && (
          <IconExternalLink
            className="ml-1.5 inline-block size-4 align-[-2px] text-neutral-300 group-hover:text-primary"
            aria-hidden="true"
          />
        )}
      </h3>
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
    </>
  );

  // Root is always an <article>: the concert link wraps the content block and the
  // calendar button is a sibling <a> — no nested anchors (nested <a> is invalid HTML,
  // broke hydration and let the parser split the card on first paint).
  return (
    <article
      className={cardClassName}
      data-proximity
      data-proximity-strength="2.1"
    >
      {concert.link ? (
        <a
          href={concert.link.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${concert.title} – ${concert.link.label}`}
          className="min-w-0 flex-1"
        >
          {inner}
        </a>
      ) : (
        <div className="min-w-0 flex-1">{inner}</div>
      )}
      <div className="flex shrink-0 justify-end md:flex-col md:items-end">
        {showCalendar && <AddToCalendarButton concert={concert} />}
      </div>
    </article>
  );
}