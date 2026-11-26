"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BeosztasHeader from "@/components/beosztas/BeosztasHeader";
import MonthNav from "@/components/beosztas/MonthNav";
import SlotTimesRow from "@/components/beosztas/SlotTimesRow";
import StateLegend from "@/components/beosztas/StateLegend";
import SlotButton from "@/components/beosztas/SlotButton";
import PeopleGate from "@/components/beosztas/PeopleGate";
import LoadPanel from "@/components/beosztas/LoadPanel";
import { useSchedule } from "@/components/beosztas/useSchedule";
import { useGridKeyboard } from "@/components/beosztas/GridKeyboard";
import { STATE_META, type CellState, type DayCounts, type SlotTime } from "@/components/beosztas/state";
import { IconSchedule } from "@/components/icons";
import {
  MONTHS,
  addDays,
  fromISODate,
  markKey,
  monthDates,
  shortDateLabel,
  toISODate,
  weekdayIndex,
  sortPeopleByName,
  WEEKDAYS_SHORT,
  type SchedPerson,
} from "@/lib/beosztas";

/** Local Date → 'YYYY-MM-DD' (never toISOString: TZ shift). */
const iso = (dd: Date) => toISODate(dd);

/* ---------- remembered person (cookie) ---------- */

const PERSON_COOKIE = "rk_beosztas_person";
const PERSON_COOKIE_DAYS = 180;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split("; ")
    .map((part) => part.split("="))
    .find(([k]) => k === name);
  return hit ? decodeURIComponent(hit.slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + PERSON_COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export default function BeosztasBoard({
  onLiveChange,
  registerRefetch,
  onQueueChange,
}: {
  onLiveChange?: (live: boolean) => void;
  registerRefetch?: (fn: () => void) => void;
  onQueueChange?: (queued: number) => void;
} = {}) {
  const d = useSchedule();
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [loadOpen, setLoadOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<null | "absent" | "clear">(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedDayState, setSelectedDay] = useState<string>(() => toISODate(new Date()));
  // Person-first: pick WHO, then mark WHEN. The board below renders only this
  // person; null = nobody chosen yet (first render shows the picker only).
  //
  // The choice is remembered in a COOKIE so the page loads back on the same
  // person. Owner's explicit call — the "do not persist on a shared machine"
  // trade-off is accepted. Read in an effect (not the initializer) because
  // cookies are not available during SSR and a mismatch would break hydration.
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  // The gate is the entry screen: people first, calendar after — never side by side.
  const [showPeople, setShowPeople] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readCookie(PERSON_COOKIE);
    if (stored) {
      setSelectedPersonId(stored);
      setShowPeople(false); // a returning visitor lands on their own calendar
    }
  }, []);

  useEffect(() => {
    if (selectedPersonId) writeCookie(PERSON_COOKIE, selectedPersonId);
  }, [selectedPersonId]);

  // Report connection state / expose a refetch to the page header.
  useEffect(() => {
    onLiveChange?.(d.live);
  }, [d.live, onLiveChange]);

  useEffect(() => {
    onQueueChange?.(d.queued);
  }, [d.queued, onQueueChange]);

  useEffect(() => {
    registerRefetch?.(() => void d.refetch());
  }, [d.refetch, registerRefetch]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthDayCount = monthDates(year, month).length;

  /**
   * Person-first selection. Derived, never stored twice: if the chosen person is
   * hidden or deleted, fall back to the first visible one, and with no people at
   * all the selection is null and the board renders the empty state.
   */
  // A–Z pools: every list of people on this page (picker, modal, availability)
  // renders from these, so the order is identical everywhere.
  const visiblePeopleAZ = useMemo(() => sortPeopleByName(d.visiblePeople), [d.visiblePeople]);
  const allPeopleAZ = useMemo(() => sortPeopleByName(d.people), [d.people]);

  const selectedPerson: SchedPerson | null = useMemo(() => {
    const pool = visiblePeopleAZ;
    if (pool.length === 0) return null;
    return pool.find((p) => p.id === selectedPersonId) ?? pool[0];
  }, [visiblePeopleAZ, selectedPersonId]);

  // Every board below is a single-person board: one "person" in the people prop.
  const boardPeople = useMemo(() => (selectedPerson ? [selectedPerson] : []), [selectedPerson]);

  /* ---------- bulk actions at the foot of the page ---------- */

  const viewDays = useMemo(() => viewDayList(year, month, toISODate(new Date())).map(toISODate), [year, month]);
  const rangeLabel = viewDays.length ? `${viewDays[0]} – ${viewDays[viewDays.length - 1]}` : "–";

  const unmarkedForSelected = useMemo(() => {
    if (!selectedPerson) return 0;
    let n = 0;
    for (const day of viewDays) {
      for (const s of d.slots) if (!d.marks.has(markKey(selectedPerson.id, day, s.id))) n += 1;
    }
    return n;
  }, [selectedPerson, viewDays, d.marks, d.slots]);

  // Deleting is always scoped to the person whose calendar is open — never to
  // "everyone visible in the range".
  const clearableCount = useMemo(() => {
    if (!selectedPerson) return 0;
    let n = 0;
    for (const day of viewDays) {
      for (const s of d.slots) if (d.marks.has(markKey(selectedPerson.id, day, s.id))) n += 1;
    }
    return n;
  }, [selectedPerson, viewDays, d.marks, d.slots]);

  const runAbsent = useCallback(async () => {
    if (!selectedPerson) return;
    setBulkBusy(true);
    const n = await d.fillUnmarked(selectedPerson.id, viewDays, "no");
    setBulkBusy(false);
    setBulkConfirm(null);
  }, [d, selectedPerson, viewDays]);

  const runClear = useCallback(async () => {
    if (!selectedPerson || viewDays.length === 0) return;
    setBulkBusy(true);
    await d.clearRange([selectedPerson.id], viewDays);
    setBulkBusy(false);
    setBulkConfirm(null);
  }, [d, selectedPerson, viewDays]);

  const dayCounts = useCallback(
    (isoDay: string): DayCounts => {
      const c: DayCounts = { yes: 0, maybe: 0, no: 0, none: 0 };
      // Person-first: only the selected person's marks feed the day summaries
      // and headers. `visiblePeople` here would count the whole band.
      for (const p of boardPeople) {
        for (const s of d.slots) {
          const st = d.marks.get(markKey(p.id, isoDay, s.id));
          if (st === "yes") c.yes++;
          else if (st === "maybe") c.maybe++;
          else if (st === "no") c.no++;
          else c.none++;
        }
      }
      return c;
    },
    [boardPeople, d.marks]
  );

  /** Row-level counts over the month (people totals under the shown range). */
  const monthMarksInView = useMemo(() => {
    let any = false;
    for (const k of d.marks.keys()) {
      // cheap: a mark key is person|YYYY-MM-DD|slot
      const parts = k.split("|");
      if (parts[1]?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) { any = true; break; }
    }
    return any;
  }, [d.marks, year, month]);

  // Month-only: the selected day is only used to keep the mobile day card in
  // sync with the shown month (never drifts into a neighbouring month).
  const selectedDay: string = selectedDayState.slice(0, 7) !== `${year}-${String(month + 1).padStart(2, "0")}`
    ? toISODate(monthDates(year, month)[0])
    : selectedDayState;

  /**
   * Picker badge, per person: answered/total for the shown month (the ratio you
   * can act on) plus a lifetime count that starts today — marks on today and any
   * future day, so it measures how many answers still lie ahead, not the history
   * (owner: "a mix, lifetime after today").
   */
  const todayIso = useMemo(() => iso(new Date()), []);
  const personProgress = useCallback(
    (personId: string) => {
      const total = monthDayCount * d.slots.length;
      let answered = 0;
      for (const dt of monthDates(year, month)) {
        const day = iso(dt);
        for (const s of d.slots) {
          if (d.marks.get(markKey(personId, day, s.id))) answered++;
        }
      }
      const slotIds = new Set(d.slots.map((s) => String(s.id)));
      let lifetime = 0;
      for (const key of d.marks.keys()) {
        const [owner, day, slotId] = key.split("|");
        if (owner !== personId) continue;
        if (!day || day < todayIso) continue;
        if (!slotIds.has(slotId)) continue;
        lifetime++;
      }
      return { answered, total, lifetime };
    },
    [d.marks, year, month, monthDayCount, todayIso]
  );

  if (showPeople) {
    return (
      <div className="flex flex-col">
        <BeosztasHeader />
        <div className="mt-4">
          <PeopleGate
            people={allPeopleAZ}
            selectedId={selectedPerson?.id ?? null}
            onSelect={(id) => {
              setSelectedPersonId(id);
              setShowPeople(false);
            }}
            onAdd={d.addPerson}
            onRemove={d.removePerson}
            onToggleVisible={d.setVisible}
            onRename={d.renamePerson}
            progress={personProgress}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <BeosztasHeader />

      {/* ---------- toolbar (§2.3) ---------- */}
      <div className="lg:sticky lg:top-0 lg:z-20 lg:-mx-2 lg:bg-background-dark/92 lg:px-2 lg:py-3 lg:backdrop-blur">
        <div className="flex flex-col gap-2.5">
          {/* row 1: month nav (month-only view — no week switch) */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="order-3 mt-1 flex w-full items-center gap-1.5 sm:order-none sm:mt-0 sm:w-auto">
              <MonthNav
                year={year}
                month={month}
                onChange={(y, m) => setCursor(new Date(y, m, 1))}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowPeople(true)}
              aria-label={`Személyváltás (jelenleg: ${selectedPerson?.name ?? "nincs kiválasztva"})`}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-neutral-border px-3.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-primary sm:h-10"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {selectedPerson?.name ?? "Személyek"}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLoadOpen(true)}
                className="inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/[0.10] px-3.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[0.16] sm:h-10"
              >
                <IconSchedule className="size-4" />
                Lehetséges próbák
              </button>
            </div>
          </div>

          {/* row 2: legend + editable slot times — shown on every screen size */}
          <div className="flex flex-col gap-2">
            <StateLegend />
            <SlotTimesRow slots={d.slots} onSave={d.updateSlot} />
          </div>
        </div>
      </div>

      {d.error && (
        <div className="mb-3 mt-2 rounded-xl border border-[#ed9a91]/30 bg-[#ed9a91]/10 px-3 py-2 text-[12.5px] text-[#ed9a91]">
          Betöltési hiba: {d.error}
        </div>
      )}

      {/* ---------- grid (always ONE person: the selected one) ---------- */}
      <div className="mt-3">
        {d.loading ? (
          <div aria-busy="true" className="py-20 text-center text-[13.5px] text-ink-faint">Betöltés…</div>
        ) : d.people.length === 0 ? (
          <EmptyGrid title="Még nincs személy" body="Add hozzá az együttes tagjait, hogy jelölhessék a próba-időpontokat." action="Személy hozzáadása" onAction={() => setShowPeople(true)} />
        ) : d.visiblePeople.length === 0 ? (
          <EmptyGrid title="Minden személy el van rejtve." body="Tegyél láthatóvá legalább egy tagot a Személyek listában." action="Személyek megnyitása" onAction={() => setShowPeople(true)} />
        ) : (
          <MonthBoard
            year={year}
            month={month}
            people={boardPeople}
            selectedName={selectedPerson?.name}
            marks={d.marks}
            locks={d.locks}
            myClientId={d.myClientId}
            pending={d.pending}
            rowError={d.rowError}
            onCycle={d.cycle}
            onEditStart={d.markRowEditing}
            onEditEnd={d.markRowBlurred}
            dayCounts={dayCounts}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            anyMarks={monthMarksInView}
            slots={d.slots}
            gridRef={gridRef}
          />
        )}
      </div>

      {/* ---------- bulk actions (foot of the page) ---------- */}
      <div className="mt-8">
        {bulkConfirm === null ? (
          <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={!selectedPerson || unmarkedForSelected === 0}
              onClick={() => setBulkConfirm("absent")}
              className="h-11 rounded-full border border-neutral-border px-4 text-[13px] font-medium text-ink-muted transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
            >
              Hiányzók jelölése – nem érek rá{unmarkedForSelected ? ` (${unmarkedForSelected})` : ""}
            </button>
            <button
              type="button"
              disabled={clearableCount === 0}
              onClick={() => setBulkConfirm("clear")}
              className="h-11 rounded-full border border-neutral-border px-4 text-[13px] font-medium text-[#ed9a91] transition-colors hover:border-[#ed9a91]/50 disabled:opacity-40"
            >
              Jelölések törlése{clearableCount ? ` (${clearableCount})` : ""}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-border bg-[#14281c] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-snug text-neutral-100">
              {bulkConfirm === "absent"
                ? `${selectedPerson?.name}: ${unmarkedForSelected} jelöletlen cella lesz „nem ér rá”. A meglévő jelölések nem változnak.`
                : `${selectedPerson?.name}: ${clearableCount} jelölés törlődik (${rangeLabel}). Más ember jelölései nem változnak. Ez nem visszavonható.`}
            </p>
            {/* right-aligned: Mégse on the left, Igen on the right */}
            <div className="flex shrink-0 justify-end gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setBulkConfirm(null)}
                className="h-11 rounded-full border border-neutral-border px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-neutral-100"
              >
                Mégse
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkConfirm === "absent" ? runAbsent : runClear}
                className="h-11 rounded-full bg-primary px-4 text-[13px] font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {bulkBusy ? "Folyamatban…" : bulkConfirm === "absent" ? "Jelölés" : "Törlés"}
              </button>
            </div>
          </div>
        )}
      </div>

      <LoadPanel
        open={loadOpen}
        onClose={() => setLoadOpen(false)}
        people={visiblePeopleAZ}
        marks={d.marks}
        slots={d.slots}
        year={year}
        month={month}
      />

    </div>
  );
}

/* ---------- empty grid ---------- */

function EmptyGrid({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-border py-16 text-center">
      <h3 className="text-[15px] font-semibold text-neutral-100">{title}</h3>
      <p className="max-w-sm px-6 text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
      <button type="button" onClick={onAction} className="mt-2 h-11 rounded-xl bg-primary px-5 text-[14px] font-semibold text-[#0b1a10] hover:opacity-90">
        {action}
      </button>
    </div>
  );
}

/* ---------- shared props ---------- */

interface BoardProps {
  people: SchedPerson[];
  /** Name of the selected person (person-first flow) — shown in board headings. */
  selectedName?: string;
  marks: Map<string, CellState>;
  locks: Record<string, { holder: string; expires_at: string }>;
  myClientId: string;
  pending: Set<string>;
  rowError: Record<string, number>;
  onCycle: (personId: string, day: string, slot: number, dir?: -1 | 1) => void;
  onEditStart: (personId: string) => void;
  onEditEnd: (personId: string) => void;
  dayCounts: (iso: string) => DayCounts;
  selectedDay: string;
  onSelectDay: (iso: string) => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
}

/* ---------- month board (§3.1 bands, §3.2 mobile) ---------- */

/*
 * Base view = the REST of the month. In the current month past days cannot be
 * rehearsed any more, so the list starts at today; any other month shows in full.
 * Used by the grid AND by the bulk actions, so both always agree on the range.
 */
function viewDayList(year: number, month: number, todayIso: string): Date[] {
  const all = monthDates(year, month);
  const isCurrentMonth = all.some((dd) => toISODate(dd) === todayIso);
  return isCurrentMonth ? all.filter((dd) => toISODate(dd) >= todayIso) : all;
}

/* ---------- month board: one row per DAY, three slot buttons horizontally ---- */

function MonthBoard({ year, month, people, selectedName, locks, myClientId, marks, pending, rowError, onCycle, onEditStart, onEditEnd, selectedDay, onSelectDay, anyMarks, gridRef, slots }: BoardProps & { year: number; month: number; anyMarks: boolean; slots: SlotTime[] }) {
  const today = toISODate(new Date());
  const dates = viewDayList(year, month, today);
  const kb = useGridKeyboard(gridRef);
  const person = people[0];

  return (
    <div>
      {!anyMarks && person && (
        <p className="mb-2 text-[13px] text-ink-faint">{person.name} még nem jelölt ebben a hónapban.</p>
      )}

      <div className="flex flex-col gap-1.5" ref={gridRef} role="grid" onKeyDown={kb.onKeyDown} aria-label={`${selectedName ?? ""} elérhetősége – ${year}. ${MONTHS[month]}`}>
        {dates.map((d) => {
          const isoTxt = toISODate(d);
          const isToday = isoTxt === today;
          const isWeekend = weekdayIndex(d) >= 5;
          return (
            <div
              key={isoTxt}
              role="row"
              className={`flex items-center gap-2 rounded-xl px-1.5 py-1.5 ${
                isToday ? "" : isWeekend ? "bg-[#f3e7c9]/[0.10]" : ""
              }`}
            >
              {/* day label */}
              <div className="flex w-[104px] shrink-0 items-baseline gap-2 sm:w-[132px]">
                <span
                  className={`text-[13.5px] font-semibold tabular-nums ${
                    isToday ? "flex size-6 items-center justify-center rounded-full bg-primary text-[#0b1a10]" : isWeekend ? "text-ink-muted" : "text-neutral-100"
                  }`}
                >
                  {d.getDate()}
                </span>
                <span className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">
                  {WEEKDAYS_SHORT[weekdayIndex(d)]}
                </span>
              </div>

              {/* three slots, horizontally */}
              {person
                ? slots.map((s) => {
                    const k = markKey(person.id, isoTxt, s.id);
                    return (
                      <div key={s.id} className="min-w-0 flex-1" onFocus={() => onEditStart(person.id)} onBlur={(e) => {
                        const next = e.relatedTarget as Node | null;
                        if (!next || !e.currentTarget.contains(next)) onEditEnd(person.id);
                      }}>
                        <SlotButton
                          state={marks.get(k) ?? null}
                          personName={person.name}
                          dateLabel={shortDateLabel(d)}
                          slotTime={s.label}
                          density="month"
                          lockedOther={!!(locks[person.id] && locks[person.id].holder !== myClientId)}
                          pending={pending.has(k)}
                          data-cell={k}
                          onCycleKey={(dir: -1 | 1) => {
                            onEditStart(person.id);
                            onCycle(person.id, isoTxt, s.id, dir);
                          }}
                          onClick={() => {
                            onEditStart(person.id);
                            onCycle(person.id, isoTxt, s.id, 1);
                          }}
                        />
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
      {person && rowError[person.id] ? (
        <p className="mt-2 text-[12.5px] text-[#ed9a91]">Nem sikerült menteni – próbáld újra.</p>
      ) : null}
    </div>
  );
}
