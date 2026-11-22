"use client";

import { useEffect, useRef, useState } from "react";
import { IconPencil } from "@/components/icons";
import { validateSlot, type SlotTime } from "@/components/beosztas/state";

/*
 * Slot times are editable and GLOBAL: the row writes `sched_slots`, every
 * visitor sees the change (realtime).
 *
 * It is laid out as the grid's column header — same day-label width, same three
 * flex columns — so each time sits directly above its own column on every
 * screen size. Tapping a time opens one editor bar under the header, because the
 * three columns are far too narrow to hold two time inputs on a phone.
 *
 * Validation is client-side for the message and server-side in the database
 * (`check (start_time < end_time)` plus a HH:MM regex), so an invalid pair
 * cannot be stored even if the UI is bypassed.
 */
export default function SlotTimesRow({
  slots,
  onSave,
}: {
  slots: SlotTime[];
  onSave: (id: 0 | 1 | 2, start: string, end: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState<0 | 1 | 2 | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing !== null) startRef.current?.focus();
  }, [editing]);

  function open(s: SlotTime) {
    setEditing(s.id);
    setStart(s.start);
    setEnd(s.end);
    setError(null);
  }

  function close() {
    setEditing(null);
    setError(null);
  }

  async function save(id: 0 | 1 | 2) {
    const problem = validateSlot(start, end);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const err = await onSave(id, start, end);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(null);
    setError(null);
  }

  return (
    <div>
      {/* column header: 104/132px label column + three equal columns, exactly like a day row */}
      <div className="flex items-center gap-2 px-1.5 pb-1">
        <div className="w-[104px] shrink-0 sm:w-[132px]">
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Időpontok</span>
        </div>
        {slots.map((s) => (
          <div key={s.id} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => open(s)}
              aria-label={`${s.id + 1}. időpont szerkesztése (${s.label})`}
              className={`flex min-h-11 w-full items-center justify-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-primary/[0.08] ${
                editing === s.id ? "bg-primary/[0.10]" : ""
              }`}
            >
              <span className="text-center text-[12px] leading-tight tabular-nums text-ink-muted">
                <span className="hidden sm:inline">{s.label}</span>
                {/* on phones the column is 73px wide: "09–12" stays on one line */}
                <span className="sm:hidden">{s.short}</span>
              </span>
              <IconPencil className="size-3 shrink-0 text-ink-faint" />
            </button>
          </div>
        ))}
      </div>

      {editing !== null && (
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-2.5 py-2">
          <span className="text-[12px] font-medium text-ink-muted">{editing + 1}. időpont</span>
          <input
            ref={startRef}
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label={`${editing + 1}. időpont kezdete`}
            className="h-11 rounded-lg border border-neutral-border bg-[#14281c] px-2 text-[13px] tabular-nums text-neutral-100 outline-none focus:border-primary/60 sm:h-9"
          />
          <span className="text-ink-faint">–</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-label={`${editing + 1}. időpont vége`}
            className="h-11 rounded-lg border border-neutral-border bg-[#14281c] px-2 text-[13px] tabular-nums text-neutral-100 outline-none focus:border-primary/60 sm:h-9"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(editing)}
            className="h-11 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-[#0b1a10] disabled:opacity-50 sm:h-9"
          >
            Mentés
          </button>
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-lg border border-neutral-border px-3 text-[12.5px] text-ink-muted sm:h-9"
          >
            Mégse
          </button>
          {error ? <span className="w-full text-[12px] text-[#ed9a91]">{error}</span> : null}
        </div>
      )}
    </div>
  );
}
