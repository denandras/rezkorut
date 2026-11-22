"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CellState, SlotTime } from "@/components/beosztas/state";
import { SLOT_TIMES as DEFAULT_SLOTS, makeSlot, nextState as cycleNextState, prevState as cyclePrevState } from "@/components/beosztas/state";
import {
  LOCK_KEY_PREFIX,
  datesInRange,
  LOCK_RENEW_MS,
  LOCK_TTL_MS,
  isLockActive,
  makeClientId,
  markKey,
  toISODate,
  type SchedMark,
  type SchedPerson,
} from "@/lib/beosztas";

/*
 * Data + realtime + optimistic write queue + soft lock lifecycle (§5).
 *
 * - All three tables are subscribed; any remote change refetches that table.
 * - Per-cell writes are serialized (one promise chain per person|day|slot) so a
 *   fast triple-click lands on the third state, not a stale cycle position.
 * - A remote change never clobbers a newer local write: while a cell is in
 *   flight (or for 2.5s after), incoming realtime for it is ignored; the DB
 *   value is then reconciled after the write resolves.
 * - Locks: upsert person:<id> with expires_at = now()+90s, renew every 30s
 *   while a row is being edited, release on blur/hide. Expired locks are
 *   filtered client-side and swept in the background. Never blocking.
 */

/* ---------- offline outbox ---------- */

/*
 * Marks made while the network is down (or the write simply failed to reach
 * Supabase) are kept in localStorage and replayed when the connection comes
 * back. Each entry is a single cell's final state, keyed the same way as
 * `sched_marks`, so replay is a plain upsert and re-running it is harmless.
 *
 * A bulk "hiányzók" fill is expanded into per-cell entries at queue time — that
 * keeps one shape to replay and means a half-finished fill cannot resurrect
 * cells the user has since cleared.
 */
const OUTBOX_KEY = "beosztas_outbox_v1";

export interface OutboxOp {
  personId: string;
  day: string;
  slot: number;
  state: CellState;
  at: number;
}

function readOutbox(): OutboxOp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(ops: OutboxOp[]) {
  if (typeof window === "undefined") return;
  try {
    if (ops.length === 0) window.localStorage.removeItem(OUTBOX_KEY);
    else window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch {
    /* quota / private mode — the optimistic UI still works for this session */
  }
}

/** Queue (or replace) one cell's pending state. */
function enqueueOp(op: OutboxOp) {
  const ops = readOutbox();
  const k = markKey(op.personId, op.day, op.slot);
  const next = ops.filter((o) => markKey(o.personId, o.day, o.slot) !== k);
  next.push(op);
  writeOutbox(next);
  return next;
}

/** A write that never reached the server (offline, DNS, connection reset). */
function isNetworkError(e: { message?: string } | null): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = (e?.message ?? "").toLowerCase();
  return /fetch|network|connection|timeout|aborted|failed to load/.test(m);
}

export interface ScheduleData {
  people: SchedPerson[];
  visiblePeople: SchedPerson[];
  /** Global slot times from `sched_slots` (shared by every visitor). */
  slots: SlotTime[];
  updateSlot: (id: 0 | 1 | 2, start: string, end: string) => Promise<string | null>;
  marks: Map<string, CellState>;
  locks: Record<string, { holder: string; expires_at: string }>; // personId → lock
  loading: boolean;
  error: string | null;
  live: boolean;
  /** Cell writes waiting for the network, from localStorage. */
  queued: number;
  syncing: boolean;
  flushQueue: () => Promise<void>;
  pending: Set<string>;
  rowError: Record<string, number>; // personId → timestamp of a save failure
  myClientId: string;
  cycle: (personId: string, day: string, slot: number, dir?: -1 | 1) => void;
  markRowEditing: (personId: string) => void;
  markRowBlurred: (personId: string) => void;
  addPerson: (name: string) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  setVisible: (id: string, visible: boolean) => Promise<void>;
  renamePerson: (id: string, name: string) => Promise<void>;
  /** Fill every UNMARKED cell of one person in a day range with `state`. Existing marks are untouched. */
  fillUnmarked: (personId: string, days: string[], state: CellState) => Promise<number>;
  /** Delete every mark of the given people on exactly these days. Returns rows removed. */
  clearRange: (personIds: string[], days: string[]) => Promise<number>;
  refetch: () => Promise<void>;
}

export function useSchedule(): ScheduleData {
  const [people, setPeople] = useState<SchedPerson[]>([]);
  const [slots, setSlots] = useState<SlotTime[]>(DEFAULT_SLOTS);
  const [marks, setMarks] = useState<Map<string, CellState>>(new Map());
  const [locks, setLocks] = useState<Record<string, { holder: string; expires_at: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, number>>({});
  const rowErrorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [myClientId] = useState<string>(() => makeClientId());
  const clientId = useRef<string>(myClientId);
  const queues = useRef<Map<string, Promise<void>>>(new Map());
  const recentWrites = useRef<Map<string, number>>(new Map());
  const lockedRow = useRef<string | null>(null);
  const renewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const marksRef = useRef<Map<string, CellState>>(new Map());

  /* ---------- fetch ---------- */

  const fetchPeople = useCallback(async () => {
    const { data, error: e } = await supabase.from("sched_people").select("*").order("sort_order", { ascending: true });
    if (e) { setError(e.message); return; }
    setPeople((data ?? []) as SchedPerson[]);
  }, []);

  const fetchMarks = useCallback(async () => {
    const { data, error: e } = await supabase.from("sched_marks").select("*");
    if (e) { setError(e.message); return; }
    const next = new Map<string, CellState>();
    for (const r of (data ?? []) as SchedMark[]) next.set(markKey(r.person_id, r.day, r.slot), r.state);
    // keep local cells that are still in flight or very fresh
    const now = Date.now();
    for (const [k, started] of recentWrites.current) {
      if (now - started < 2500 && !next.has(k)) {
        const local = marksRef.current.get(k);
        if (local) next.set(k, local);
      }
    }
    // Pending offline writes win over the server copy: they are newer than it.
    for (const op of readOutbox()) next.set(markKey(op.personId, op.day, op.slot), op.state);
    setMarks(next);
    marksRef.current = next;
    setQueued(readOutbox().length);
    setError(null);
  }, []);

  const fetchSlots = useCallback(async () => {
    const { data, error: e } = await supabase.from("sched_slots").select("slot,start_time,end_time").order("slot", { ascending: true });
    if (e || !data?.length) return;
    const map = new Map((data as { slot: number; start_time: string; end_time: string }[]).map((r) => [r.slot, r]));
    setSlots(
      ([0, 1, 2] as const).map((id) => {
        const r = map.get(id);
        return r ? makeSlot(id, r.start_time, r.end_time) : DEFAULT_SLOTS[id];
      })
    );
  }, []);

  const fetchLocks = useCallback(async () => {
    const { data, error: e } = await supabase.from("sched_locks").select("*");
    if (e) return;
    const now = Date.now();
    const map: Record<string, { holder: string; expires_at: string }> = {};
    for (const r of (data ?? []) as { key: string; holder: string; expires_at: string }[]) {
      if (!r.key.startsWith(LOCK_KEY_PREFIX)) continue;
      if (!isLockActive(r, now)) continue; // expired → ignored
      map[r.key.slice(LOCK_KEY_PREFIX.length)] = { holder: r.holder, expires_at: r.expires_at };
    }
    setLocks(map);
  }, []);

  const refetch = useCallback(async () => {
    await Promise.all([fetchPeople(), fetchMarks(), fetchLocks(), fetchSlots()]);
    setLoading(false);
  }, [fetchPeople, fetchMarks, fetchLocks, fetchSlots]);

  useEffect(() => {
    // Microtask: lets the loading paint commit first, then the fetch resolves async.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) refetch();
    });
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  /* ---------- realtime: all three tables ---------- */

  useEffect(() => {
    const ch = supabase
      .channel("beosztas-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sched_people" }, () => void fetchPeople())
      .on("postgres_changes", { event: "*", schema: "public", table: "sched_marks" }, (payload) => {
        const row = (payload.new ?? payload.old) as Partial<SchedMark> | null;
        if (row?.person_id && row?.day && typeof row.slot === "number") {
          const k = markKey(row.person_id, row.day, row.slot);
          const started = recentWrites.current.get(k);
          if (started !== undefined && Date.now() - started < 2500) return; // my write wins
        }
        void fetchMarks();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sched_locks" }, () => void fetchLocks())
      .on("postgres_changes", { event: "*", schema: "public", table: "sched_slots" }, () => void fetchSlots())
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchPeople, fetchMarks, fetchLocks, fetchSlots]);

  /* ---------- lock housekeeping: expiry tick + background sweep ---------- */

  useEffect(() => {
    const t = setInterval(() => {
      setLocks((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [pid, l] of Object.entries(prev)) {
          if (isLockActive({ key: "", holder: l.holder, expires_at: l.expires_at })) next[pid] = l;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sweep = () => {
      void supabase.from("sched_locks").delete().lt("expires_at", new Date().toISOString());
    };
    sweep();
    const t = setInterval(sweep, 60_000);
    return () => clearInterval(t);
  }, []);

  /* ---------- soft lock ---------- */

  const upsertLock = useCallback(async (personId: string) => {
    const expires = new Date(Date.now() + LOCK_TTL_MS).toISOString();
    setLocks((prev) => ({ ...prev, [personId]: { holder: clientId.current, expires_at: expires } }));
    const { error: e } = await supabase
      .from("sched_locks")
      .upsert({ key: `${LOCK_KEY_PREFIX}${personId}`, holder: clientId.current, expires_at: expires }, { onConflict: "key" });
    if (e) console.error("lock upsert:", e);
  }, []);

  const releaseLock = useCallback(async (personId: string) => {
    await supabase.from("sched_locks").delete().eq("key", `${LOCK_KEY_PREFIX}${personId}`).eq("holder", clientId.current);
    setLocks((prev) => {
      const copy = { ...prev };
      if (copy[personId]?.holder === clientId.current) delete copy[personId];
      return copy;
    });
  }, []);

  const markRowEditing = useCallback(
    (personId: string) => {
      const prev = lockedRow.current;
      if (prev === personId) {
        void upsertLock(personId);
        return;
      }
      if (prev) void releaseLock(prev);
      lockedRow.current = personId;
      void upsertLock(personId);
      if (renewTimer.current) clearInterval(renewTimer.current);
      renewTimer.current = setInterval(() => {
        if (lockedRow.current) void upsertLock(lockedRow.current);
      }, LOCK_RENEW_MS);
    },
    [upsertLock, releaseLock]
  );

  const markRowBlurred = useCallback(
    (personId: string) => {
      if (lockedRow.current !== personId) return;
      lockedRow.current = null;
      if (renewTimer.current) { clearInterval(renewTimer.current); renewTimer.current = null; }
      void releaseLock(personId);
    },
    [releaseLock]
  );

  useEffect(() => {
    const onHide = () => {
      if (!lockedRow.current) return;
      const pid = lockedRow.current;
      lockedRow.current = null;
      // beacon-free: fire and forget; the 90s TTL cleans up if it never lands.
      void releaseLock(pid);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (renewTimer.current) clearInterval(renewTimer.current);
      onHide();
    };
  }, [releaseLock]);

  /* ---------- cell cycle, serialized per cell ---------- */

  const writeCell = useCallback(
    async (personId: string, day: string, slot: number, target: CellState, previous: CellState) => {
      const k = markKey(personId, day, slot);
      recentWrites.current.set(k, Date.now());
      let err: { message: string } | null = null;
      if (target === null) {
        const res = await supabase.from("sched_marks").delete().eq("person_id", personId).eq("day", day).eq("slot", slot);
        err = res.error;
      } else {
        const res = await supabase.from("sched_marks").upsert(
          { person_id: personId, day, slot, state: target, updated_at: new Date().toISOString() },
          { onConflict: "person_id,day,slot" }
        );
        err = res.error;
      }
      if (err && isNetworkError(err)) {
        // Offline: keep the optimistic value, remember it, and replay later.
        const ops = enqueueOp({ personId, day, slot, state: target, at: Date.now() });
        setQueued(ops.length);
        return;
      }
      if (err) {
        console.error("mark write:", err);
        setMarks((prev) => {
          const next = new Map(prev);
          if (previous === null) next.delete(k);
          else next.set(k, previous);
          return next;
        });
        setRowError((prev) => ({ ...prev, [personId]: Date.now() }));
        const timers = rowErrorTimers.current;
        const existing = timers.get(personId);
        if (existing) clearTimeout(existing);
        timers.set(
          personId,
          setTimeout(() => {
            setRowError((prev) => {
              const copy = { ...prev };
              delete copy[personId];
              return copy;
            });
            timers.delete(personId);
          }, 6000)
        );
      }
    },
    []
  );

  const cycle = useCallback(
    (personId: string, day: string, slot: number, dir: -1 | 1 = 1) => {
      const k = markKey(personId, day, slot);
      const current = marksRef.current.get(k) ?? null;
      const target = dir === 1 ? cycleNextState(current) : cyclePrevState(current);

      // Optimistic — from the last rendered state, so rapid clicks advance correctly.
      setMarks((prev) => {
        const next = new Map(prev);
        if (target === null) next.delete(k);
        else next.set(k, target);
        marksRef.current = next;
        return next;
      });
      setPending((prev) => new Set(prev).add(k));

      const prevChain = queues.current.get(k) ?? Promise.resolve();
      const chain = prevChain
        .catch(() => {})
        .then(() => writeCell(personId, day, slot, target, current))
        .then(() => {
          setPending((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          queues.current.delete(k);
        });
      queues.current.set(k, chain);
    },
    [writeCell]
  );

  /* ---------- people management ---------- */

  const addPerson = useCallback(
    async (name: string) => {
      const maxSort = people.reduce((m, p) => Math.max(m, p.sort_order), -1);
      const tempId = `tmp-${Date.now()}`;
      setPeople((prev) => [...prev, { id: tempId, name, sort_order: maxSort + 1, visible: true, created_at: new Date().toISOString() }]);
      const { data, error: e } = await supabase.from("sched_people").insert({ name, sort_order: maxSort + 1, visible: true }).select().single();
      if (e || !data) {
        setPeople((prev) => prev.filter((p) => p.id !== tempId));
        setError(e?.message ?? "Nem sikerült hozzáadni.");
        return;
      }
      setPeople((prev) => prev.map((p) => (p.id === tempId ? (data as SchedPerson) : p)));
    },
    [people]
  );

  const removePerson = useCallback(async (id: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== id));
    const { error: e } = await supabase.from("sched_people").delete().eq("id", id);
    if (e) console.error("remove person:", e);
  }, []);

  const setVisible = useCallback(async (id: string, visible: boolean) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, visible } : p)));
    const { error: e } = await supabase.from("sched_people").update({ visible }).eq("id", id);
    if (e) console.error("visibility:", e);
  }, []);

  const renamePerson = useCallback(async (id: string, name: string) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    const { error: e } = await supabase.from("sched_people").update({ name }).eq("id", id);
    if (e) console.error("rename:", e);
  }, []);

  /* ---------- bulk operations (end-of-page actions) ---------- */

  /*
   * "Hiányzók jelölése" — a member at the end of a rehearsal season wants to say
   * "everything I have not answered, I cannot do". Only blanks are written:
   * an existing yes/maybe/no is never overwritten, so this cannot destroy an
   * answer that was given deliberately.
   */
  const fillUnmarked = useCallback(async (personId: string, days: string[], state: CellState) => {
    if (state === null) return 0;
    const rows: { person_id: string; day: string; slot: number; state: string; updated_at: string }[] = [];
    const now = new Date().toISOString();
    for (const day of days) {
      for (const slot of [0, 1, 2]) {
        if (marksRef.current.has(markKey(personId, day, slot))) continue;
        rows.push({ person_id: personId, day, slot, state, updated_at: now });
      }
    }
    if (rows.length === 0) return 0;

    // optimistic
    const next = new Map(marksRef.current);
    for (const r of rows) next.set(markKey(r.person_id, r.day, r.slot), state);
    marksRef.current = next;
    setMarks(next);
    for (const r of rows) recentWrites.current.set(markKey(r.person_id, r.day, r.slot), Date.now());

    const { error: e } = await supabase.from("sched_marks").upsert(rows, { onConflict: "person_id,day,slot" });
    if (e) {
      if (isNetworkError(e)) {
        let ops = readOutbox();
        for (const r of rows) ops = enqueueOp({ personId: r.person_id, day: r.day, slot: r.slot, state, at: Date.now() });
        setQueued(readOutbox().length);
        return rows.length;
      }
      console.error("fill unmarked:", e);
      setError(e.message);
      await fetchMarks();
      return 0;
    }
    return rows.length;
  }, [fetchMarks]);

  /*
   * "Láthatók törlése" — bulk delete, scoped to the EXACT day list the UI counted
   * (one delete per day), never a range. A `gte/lte` range can silently widen when
   * a boundary is malformed and then the reported count stops matching what was
   * removed; deleting day by day cannot leave the view.
   */
  const clearRange = useCallback(async (personIds: string[], days: string[]) => {
    if (personIds.length === 0 || days.length === 0) return 0;
    let removed = 0;
    for (const day of days) {
      const { data, error: e } = await supabase
        .from("sched_marks")
        .delete()
        .in("person_id", personIds)
        .eq("day", day)
        .select("id");
      if (e) {
        console.error("clear range:", e);
        setError(e.message);
        break;
      }
      removed += (data ?? []).length;
    }
    // Audit trail: a bulk delete must be reconstructible afterwards. Best-effort,
    // never blocks the operation or surfaces an error to the user.
    void supabase
      .from("sched_audit")
      .insert({
        action: "clear_range",
        detail: { people: personIds.length, from: days[0] ?? null, to: days[days.length - 1] ?? null, days: days.length, removed },
      })
      .then(({ error: auditError }) => {
        if (auditError) console.error("audit:", auditError);
      });

    setMarks((prev) => {
      const next = new Map(prev);
      for (const pid of personIds) for (const day of days) for (const slot of [0, 1, 2]) next.delete(markKey(pid, day, slot));
      marksRef.current = next;
      return next;
    });
    return removed;
  }, []);

  /** Replay queued offline writes. Safe to call repeatedly; stops on the first failure. */
  const flushQueue = useCallback(async () => {
    const ops = readOutbox();
    if (ops.length === 0) {
      setQueued(0);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    setSyncing(true);
    const remaining: OutboxOp[] = [...ops];
    for (const op of ops) {
      const { error: e } = await supabase
        .from("sched_marks")
        .upsert(
          { person_id: op.personId, day: op.day, slot: op.slot, state: op.state, updated_at: new Date().toISOString() },
          { onConflict: "person_id,day,slot" }
        );
      if (e) {
        console.error("flush:", e);
        break; // keep the rest; the next tick or the online event retries
      }
      recentWrites.current.set(markKey(op.personId, op.day, op.slot), Date.now());
      remaining.shift();
    }
    writeOutbox(remaining);
    setQueued(remaining.length);
    setSyncing(false);
    if (remaining.length === 0) await fetchMarks();
  }, [fetchMarks]);

  /* ---------- offline queue: replay when the connection returns ---------- */

  useEffect(() => {
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    // A silent retry also covers the case where the browser never fired the
    // event (proxy hiccups, sleeping laptop waking on the same network).
    const t = setInterval(() => {
      if (readOutbox().length > 0) void flushQueue();
    }, 20_000);
    void flushQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [flushQueue]);


  /** Saves a slot time globally. Returns an error string, or null on success. */
  const updateSlot = useCallback(async (id: 0 | 1 | 2, start: string, end: string) => {
    const prev = slots.find((s) => s.id === id);
    setSlots((cur) => cur.map((s) => (s.id === id ? makeSlot(id, start, end) : s)));
    const { error: e } = await supabase
      .from("sched_slots")
      .upsert({ slot: id, start_time: start, end_time: end, updated_at: new Date().toISOString() }, { onConflict: "slot" });
    if (e) {
      if (prev) setSlots((cur) => cur.map((s) => (s.id === id ? prev : s)));
      return "Nem sikerült menteni az időpontot.";
    }
    return null;
  }, [slots]);

  const visiblePeople = useMemo(() => people.filter((p) => p.visible), [people]);

  return {
    people,
    visiblePeople,
    slots,
    updateSlot,
    marks,
    locks,
    loading,
    error,
    live,
    queued,
    syncing,
    flushQueue,
    pending,
    rowError,
    myClientId,
    cycle,
    markRowEditing,
    markRowBlurred,
    addPerson,
    removePerson,
    setVisible,
    renamePerson,
    fillUnmarked,
    clearRange,
    refetch,
  };
}
