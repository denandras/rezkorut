import type { TicketingInfo } from "./types";

/** The four states a concert's ticketing can be shown in. */
export type PillState = "none" | "on_sale" | "sold_out" | "closed";

/** Maps a ticketing status (or its absence) onto the four pill states. */
export function pillState(ticketing: TicketingInfo | null): PillState {
  if (!ticketing || ticketing.status === "draft") return "none";
  return ticketing.status;
}

const PILL_CLASS: Record<PillState, string> = {
  none: "border-neutral-border/80 bg-neutral-dark/70 text-neutral-400",
  on_sale: "border-[#86e3a0]/40 bg-[#86e3a0]/10 text-[#86e3a0]",
  sold_out: "border-[#e6be5f]/40 bg-[#e6be5f]/10 text-[#e6be5f]",
  closed: "border-neutral-border/60 bg-neutral-dark/40 text-neutral-500",
};

const PILL_LABEL: Record<PillState, string> = {
  none: "Nincs jegyértékesítés",
  on_sale: "Értékesítés alatt",
  sold_out: "Elfogyott",
  closed: "Lezárva",
};

export default function StatusPill({ state }: { state: PillState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${PILL_CLASS[state]}`}
    >
      {PILL_LABEL[state]}
    </span>
  );
}
