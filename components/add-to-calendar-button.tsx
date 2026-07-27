"use client";

import { IconGoogleCalendar } from "@/components/icons";
import { generateGoogleCalendarUrl } from "@/lib/calendar-url";
import type { Concert } from "@/lib/upcoming-concerts";

type AddToCalendarButtonProps = {
  concert: Concert;
};

export default function AddToCalendarButton({ concert }: AddToCalendarButtonProps) {
  const href = generateGoogleCalendarUrl(concert);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 hover:border-primary/50"
      aria-label={`Naptárba mentés: ${concert.title}`}
    >
      <IconGoogleCalendar className="size-3.5" />
      <span>Naptárba</span>
    </a>
  );
}