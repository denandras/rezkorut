"use client";

import { IconPencil } from "@/components/icons";

/*
 * "Someone else is editing this row" (§4.3) — a soft pill, auto-expiring,
 * never blocking. Mobile shows the initials only; the sentence stays in the
 * accessible description.
 */
export default function LockHint({ personId, personName, holder }: { personId: string; personName: string; holder: string }) {
  const tag = holder.replace(/^c-/, "").slice(0, 2).toUpperCase() || "?";
  const initial = personName.trim().charAt(0).toUpperCase() || "?";
  return (
    <p
      id={`lock-${personId}`}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/[0.08] px-2 py-1 text-[11px] font-medium text-primary/80"
      title={`Valaki épp ezt a sort szerkeszti (${holder}) — ez csak jelzés, nem tiltás`}
      data-lock-holder={holder}
    >
      <IconPencil className="size-3" />
      <span className="tabular-nums">
        {initial}
        {tag}
      </span>
      <span className="hidden sm:inline">szerkeszti</span>
    </p>
  );
}
