"use client";

import { useState } from "react";
import { IconCheck, IconClose, IconEye, IconEyeOff, IconPencil } from "@/components/icons";
import { initialsOf, sortPeopleByName, type SchedPerson } from "@/lib/beosztas";

/*
 * The entry screen: pick who you are, and manage the band in the same place.
 *
 * It replaces the old pair of "vertical chip list" + "Személyek modal": the owner
 * wanted ONE place, on the page, with no dialog to open — so adding, renaming,
 * hiding and removing all happen inline here, next to the choice itself.
 *
 * Selecting a person leaves this screen entirely (the calendar takes over, not
 * side by side), and the choice is remembered in a cookie so a returning
 * visitor lands straight on their own calendar.
 */

export interface PeopleGateProps {
  people: SchedPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRename: (id: string, name: string) => void;
  progress: (personId: string) => { answered: number; total: number };
}

export default function PeopleGate({
  people,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onToggleVisible,
  onRename,
  progress,
}: PeopleGateProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const ordered = sortPeopleByName(people);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (people.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      setError("Már van ilyen nevű személy.");
      return;
    }
    setError(null);
    onAdd(n);
    setName("");
  }

  function commitRename(id: string) {
    const n = editName.trim();
    const dup = n && people.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
    if (n && !dup) onRename(id, n);
    setEditingId(null);
  }

  return (
    <section aria-labelledby="gate-title" className="flex flex-col gap-3">
      <div>
        <h2 id="gate-title" className="font-display text-[19px] font-semibold text-neutral-100">
          Ki jelöl?
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">Válaszd ki magad — utána nyílik a naptár.</p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {ordered.map((p) => {
          const sel = p.id === selectedId;
          const { answered, total } = progress(p.id);
          const confirming = confirmId === p.id;
          const editing = editingId === p.id;

          return (
            <li
              key={p.id}
              className={`flex items-center gap-1.5 rounded-xl border px-1.5 py-1 transition-colors ${
                sel ? "border-primary/60 bg-primary/[0.10]" : "border-neutral-border bg-neutral-dark/40"
              }`}
            >
              {editing ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5">
                  <input
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label={`${p.name} új neve`}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-primary/50 bg-[#0b1a10] px-2.5 text-[14px] text-neutral-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commitRename(p.id)}
                    className="flex size-10 items-center justify-center rounded-full bg-primary text-[#0b1a10]"
                    aria-label="Név mentése"
                  >
                    <IconCheck className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="flex size-10 items-center justify-center rounded-full text-ink-muted hover:text-neutral-100"
                    aria-label="Név szerkesztésének elvetése"
                  >
                    <IconClose className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  {/* the row itself is the selector */}
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    aria-current={sel ? "true" : undefined}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-primary/[0.06]"
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-wide ${
                        sel ? "bg-primary text-[#0b1a10]" : "bg-primary/[0.12] text-primary"
                      }`}
                      aria-hidden="true"
                    >
                      {initialsOf(p.name)}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[14.5px] font-medium ${
                        p.visible ? "text-neutral-100" : "text-ink-faint line-through decoration-[#2a4a36]"
                      }`}
                    >
                      {p.name}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">
                      {answered}/{total}
                    </span>
                  </button>

                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onRemove(p.id);
                          setConfirmId(null);
                        }}
                        className="h-9 rounded-full bg-[#ed9a91]/15 px-3 text-[12.5px] font-medium text-[#ed9a91]"
                      >
                        Törlés
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="h-9 rounded-full px-2 text-[12.5px] text-ink-muted hover:text-neutral-100"
                      >
                        Mégse
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.visible}
                        aria-label={`${p.name} megjelenítése`}
                        title={p.visible ? "Elrejtés a naptárból" : "Megjelenítés a naptárban"}
                        onClick={() => onToggleVisible(p.id, !p.visible)}
                        className="flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-neutral-100"
                      >
                        {p.visible ? <IconEye className="size-[17px]" /> : <IconEyeOff className="size-[17px]" />}
                      </button>
                      <button
                        type="button"
                        aria-label={`${p.name} átnevezése`}
                        onClick={() => {
                          setEditingId(p.id);
                          setEditName(p.name);
                        }}
                        className="flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-primary"
                      >
                        <IconPencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${p.name} eltávolítása`}
                        onClick={() => setConfirmId(p.id)}
                        className="flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-[#ed9a91]/10 hover:text-[#ed9a91]"
                      >
                        <IconClose className="size-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
        {people.length === 0 && <li className="py-2 text-[14px] text-ink-muted">Még nincs személy.</li>}
      </ul>

      <form onSubmit={submit} className="mt-1 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-person" className="sr-only">
          Új személy neve
        </label>
        <input
          id="new-person"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Új személy neve"
          className="h-12 w-full rounded-xl border border-neutral-border bg-[#0b1a10] px-4 text-[15px] text-neutral-100 outline-none transition-colors placeholder:text-ink-faint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-12 shrink-0 rounded-xl bg-primary px-5 text-[14px] font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Hozzáadás
        </button>
      </form>
      {error ? <p className="text-[12.5px] text-[#ed9a91]">{error}</p> : null}
    </section>
  );
}
