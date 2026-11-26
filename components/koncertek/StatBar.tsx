/**
 * StatBar — the owner's stats rule: number + bar. Number left, bar right;
 * gold fill on a dark track. No capacity limit → the number is "N db" and
 * the bar is a muted full fill (sold) or empty (none sold yet).
 */
export default function StatBar({
  sold,
  capacity,
}: {
  sold: number;
  capacity: number | null;
}) {
  const unlimited = capacity === null;
  const percent =
    !unlimited && capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : null;

  return (
    <div className="flex min-w-0 items-center gap-2.5" aria-label={`${sold} eladott jegy`}>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-200">
        {unlimited ? `${sold} db` : `${sold} / ${capacity} db`}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-charcoal">
        <span
          className={`block h-full rounded-full ${
            percent !== null
              ? "bg-primary"
              : unlimited && sold > 0
                ? "bg-primary/30"
                : "bg-transparent"
          }`}
          style={{ width: percent !== null ? `${percent}%` : unlimited && sold > 0 ? "100%" : "0%" }}
        />
      </span>
    </div>
  );
}
