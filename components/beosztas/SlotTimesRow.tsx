"use client";

import { useEffect, useRef, useState } from "react";
import { IconPencil } from "@/components/icons";
import { validateSlot, type SlotTime } from "@/components/beosztas/state";

/*
 * Slot times are editable and GLOBAL: the row writes `sched_slots`, every
 * visitor sees the change (realtime). Editing happens inline — pencil → two time
 * fields → save — so the times stay where they are read, instead of hiding in a
 * settings dialog.
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Időpontok</span>
      {slots.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1.5">
          {i > 0 && <span className="mr-1 text-neutral-border" aria-hidden="true">·</span>}

          {editing === s.id ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={startRef}
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label={`${i + 1}. időpont kezdete`}
                className="h-9 rounded-lg border border-neutral-border bg-[#14281c] px-2 text-[13px] tabular-nums text-neutral-100 outline-none focus:border-primary/60"
              />
              <span className="text-ink-faint">–</span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label={`${i + 1}. időpont vége`}
                className="h-9 rounded-lg border border-neutral-border bg-[#14281c] px-2 text-[13px] tabular-nums text-neutral-100 outline-none focus:border-primary/60"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(s.id)}
                className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-[#0b1a10] disabled:opacity-50"
              >
                Mentés
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
                className="h-9 rounded-lg border border-neutral-border px-3 text-[12.5px] text-ink-muted"
              >
                Mégse
              </button>
              {error ? <span className="w-full text-[12px] text-[#ed9a91]">{error}</span> : null}
            </div>
          ) : (
            <>
              <span className="text-[12px] text-ink-muted">
                <span className="text-ink-faint">{s.id + 1}.</span> {s.label}
              </span>
              <button
                type="button"
                onClick={() => open(s)}
                aria-label={`${s.id + 1}. időpont szerkesztése (${s.label})`}
                className="flex size-7 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-primary"
              >
                <IconPencil className="size-3.5" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
