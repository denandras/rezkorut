"use client";

import { dayCaption, daySentence, type DayCounts } from "@/components/beosztas/state";

/*
 * Per-day summary (§1.2): a 4-segment bar where unanswered is the bare track,
 * plus (week view only) the printed caption with all four counts.
 * Zero is data: "0 ÜRES" is printed when every visible person answered.
 */
export default function DaySummary({
  counts,
  density,
  showCaption = false,
  maxWidth = 64,
  allYes = false,
}: {
  counts: DayCounts;
  density: "month" | "week";
  showCaption?: boolean;
  maxWidth?: number;
  allYes?: boolean;
}) {
  const total = counts.yes + counts.maybe + counts.no + counts.none;
  const h = density === "week" ? "h-2" : "h-1.5";
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-full ${h} overflow-hidden rounded-full bg-[#14281c] ${allYes ? "ring-1 ring-[#86e3a0]/30" : ""}`}
        style={{ maxWidth }}
        title={daySentence(counts, total)}
      >
        <div className="flex h-full w-full">
          {counts.yes > 0 && <span className="h-full opacity-70" style={{ width: `${pct(counts.yes)}%`, backgroundColor: "#86e3a0" }} />}
          {counts.maybe > 0 && <span className="h-full opacity-70" style={{ width: `${pct(counts.maybe)}%`, backgroundColor: "#e6be5f" }} />}
          {counts.no > 0 && <span className="h-full opacity-70" style={{ width: `${pct(counts.no)}%`, backgroundColor: "#ed9a91" }} />}
        </div>
      </div>
      {showCaption && (
        <p className="text-center text-[11px] uppercase tracking-[0.14em] text-ink-faint tabular-nums" aria-label={dayCaption(counts).toLowerCase()}>
          {dayCaption(counts)}
        </p>
      )}
    </div>
  );
}
