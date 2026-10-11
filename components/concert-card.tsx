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
      <div className="flex shrink-0 flex-col items-end gap-2">
        {concert.link && (
          <IconExternalLink
            className="mt-0.5 size-5 text-neutral-300 transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
        )}
        {showCalendar && <AddToCalendarButton concert={concert} />}
      </div>
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
    <article
      className={cardClassName}
      data-proximity
      data-proximity-strength="2.1"
    >
      {cardContent}
    </article>
  );
}