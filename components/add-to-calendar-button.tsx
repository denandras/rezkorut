"use client";

import { useState } from "react";
import { IconBell } from "@/components/icons";
import { generateConcertICS } from "@/lib/ics";
import type { Concert } from "@/lib/upcoming-concerts";

type AddToCalendarButtonProps = {
  concert: Concert;
};

export default function AddToCalendarButton({ concert }: AddToCalendarButtonProps) {
  const [error, setError] = useState(false);

  const handleClick = () => {
    const result = generateConcertICS(concert);
    if (!result) {
      setError(true);
      return;
    }

    const blob = new Blob([result.ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (error) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 hover:border-primary/50"
      aria-label={`Naptárba mentés: ${concert.title}`}
    >
      <IconBell className="size-3.5" />
      <span>Naptárba</span>
    </button>
  );
}