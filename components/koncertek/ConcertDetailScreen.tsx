"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ConcertForm from "./ConcertForm";
import OrdersTable from "./OrdersTable";
import StatBar from "./StatBar";
import StatusPill, { pillState } from "./StatusPill";
import TacitoTile from "./TacitoTile";
import TicketTypeEditor from "./TicketTypeEditor";
import {
  formatHuf,
  huDateToIso,
  todayIsoInBudapest,
  type ApiConcert,
  type ApiOrder,
  type TacitoStatus,
} from "./types";

/**
 * Client half of /intern/koncertek/[id]. The server page seeds the concert
 * (from the list API) and its orders; every mutation — type editor save,
 * publish, close, refund, edit, delete — refreshes the same two endpoints
 * so the card 02 API stays the only data source.
 */

export default function ConcertDetailScreen({
  concertId,
  initialConcert,
  initialOrders,
  initialStatus,
}: {
  concertId: string;
  initialConcert: ApiConcert | null;
  initialOrders: ApiOrder[] | null;
  initialStatus: TacitoStatus | null;
}) {
  const [concert, setConcert] = useState<ApiConcert | null>(initialConcert);
  const [orders, setOrders] = useState<ApiOrder[] | null>(initialOrders);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const reloadConcert = useCallback(async () => {
    try {
      const res = await fetch("/api/intern/koncertek", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { concerts?: ApiConcert[]; error?: string }
        | null;
      if (!res.ok || !data?.concerts) return;
      setConcert(data.concerts.find((entry) => entry.id === concertId) ?? null);
    } catch {
      /* keep the last known state */
    }
  }, [concertId]);

  const reloadOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/intern/koncertek/${concertId}/orders`, { cache: "no-store" });
      if (res.status === 404) {
        setOrders([]);
        return;
      }
      const data = (await res.json().catch(() => null)) as { orders?: ApiOrder[] } | null;
      if (res.ok && data?.orders) setOrders(data.orders);
    } catch {
      /* keep the last known state */
    }
  }, [concertId]);

  // A concert with no rk_concerts row yet answers the orders endpoint with
  // 404, so the server render could not seed the list — fetch it once here.
  const triedInitialOrders = useRef(false);
  useEffect(() => {
    if (initialOrders === null && !triedInitialOrders.current) {
      triedInitialOrders.current = true;
      reloadOrders();
    }
  }, [initialOrders, reloadOrders]);

  /**
   * Why the sales cannot start yet — computed from the SAVED types, the same
   * facts the publish endpoint checks server-side. Shown inline after the
   * click, never pre-emptively.
   */
  function explainPublishBlock(reason: string): string {
    return reason;
  }

  function handlePublish() {
    if (actionPending) return;
    setActionError(null);
    setActionNotice(null);

    const types = concert?.ticketing?.types ?? [];
    const activeTypes = types.filter((type) => type.active);
    if (activeTypes.length === 0) {
      setActionError(
        explainPublishBlock(
          "Nincs még mentett, aktív jegytípus – hozzon létre egyet és mentse el előbb.",
        ),
      );
      return;
    }
    if (activeTypes.some((type) => type.price_huf < 200)) {
      setActionError(
        explainPublishBlock("Van jegytípus, amelynek ára kevesebb mint 200 forint – növelje az árat."),
      );
      return;
    }
    const iso = huDateToIso(concert?.date ?? "");
    if (!iso || iso < todayIsoInBudapest()) {
      setActionError(
        explainPublishBlock("A koncert dátuma már elmúlt, a jegyértékesítés nem indítható."),
      );
      return;
    }

    setActionPending(true);
    fetch(`/api/intern/koncertek/${concertId}/publish`, { method: "POST" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionPending(false);
        if (!response.ok) {
          setActionError(data?.error ?? "Nem sikerült elindítani a jegyértékesítést.");
          return;
        }
        setActionNotice("A jegyértékesítés elindult.");
        reloadConcert();
      })
      .catch(() => {
        setActionPending(false);
        setActionError("Nem sikerült elindítani a jegyértékesítést. Kérem, próbálja újra.");
      });
  }

  function handleClose() {
    if (actionPending) return;
    setActionError(null);
    setActionNotice(null);
    setActionPending(true);
    fetch(`/api/intern/koncertek/${concertId}/close`, { method: "POST" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionPending(false);
        if (!response.ok) {
          setActionError(data?.error ?? "Nem sikerült leállítani a jegyértékesítést.");
          return;
        }
        setActionNotice("A jegyértékesítés leállítva.");
        reloadConcert();
      })
      .catch(() => {
        setActionPending(false);
        setActionError("Nem sikerült leállítani a jegyértékesítést. Kérem, próbálja újra.");
      });
  }

  if (!concert) {
    return (
      <div className="flex min-h-dvh flex-col bg-background-dark">
        <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
          <a
            href="/intern/koncertek"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza a koncertekhez
          </a>
          <p className="mt-6 text-sm text-neutral-300">Nincs ilyen koncert.</p>
        </main>
      </div>
    );
  }

  const state = pillState(concert.ticketing);
  const ticketing = concert.ticketing;
  const place = [concert.location, concert.venue].filter((part) => part).join(", ");
  const onSale = ticketing?.status === "on_sale" || ticketing?.status === "sold_out";
  const revenue = ticketing?.revenue_huf ?? 0;
  const sold = ticketing?.sold ?? 0;

  return (
    <div className="flex min-h-dvh flex-col bg-background-dark">
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <a
            href="/intern/koncertek"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza a koncertekhez
          </a>
          <a
            href={`/intern/koncertek/${concertId}/beleptetes`}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90"
          >
            Beléptetés
          </a>
        </div>

        <section className="mb-4 rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight text-neutral-100">
                {concert.title}
              </h1>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-primary">
                {concert.date}
                {concert.time ? ` – ${concert.time}` : ""}
              </p>
              {place && <p className="mt-0.5 text-xs text-neutral-400">{place}</p>}
            </div>
            <StatusPill state={state} />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => {
                setShowForm((open) => !open);
                setActionError(null);
                setActionNotice(null);
              }}
              className="text-sm text-neutral-400 transition-colors hover:text-primary"
            >
              {showForm ? "Szerkesztés bezárása" : "Szerkesztés"}
            </button>
            {concert.program && concert.program.length > 0 && (
              <p className="text-xs text-neutral-500">
                Műsor: {concert.program.length} tétel
              </p>
            )}
          </div>
        </section>

        {showForm && (
          <div className="mb-4">
            <ConcertForm
              concert={concert}
              onSaved={() => {
                setShowForm(false);
                reloadConcert();
              }}
              onDeleted={() => {
                window.location.assign("/intern/koncertek");
              }}
              onClose={() => setShowForm(false)}
            />
          </div>
        )}

        <div className="mb-4">
          <TicketTypeEditor
            concertId={concertId}
            ticketing={ticketing}
            onSaved={() => {
              reloadConcert();
              reloadOrders();
            }}
          />
        </div>

        {/* Jegyértékesítés indítása / leállítása */}
        <section className="mb-4 rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
          <h3 className="font-display text-base font-bold text-neutral-100">Jegyértékesítés</h3>
          {onSale ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={handleClose}
                className={`rounded-lg border border-neutral-border bg-neutral-dark px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:border-primary/50 hover:text-primary ${
                  actionPending ? "opacity-50" : ""
                }`}
              >
                Jegyértékesítés leállítása
              </button>
              <p className="mt-2 text-xs text-neutral-500">
                A leállítás után a jegyek nem vásárolhatók meg; a meglévő rendelések megmaradnak.
              </p>
            </div>
          ) : (
            <div className="mt-2">
              <button
                type="button"
                onClick={handlePublish}
                className={`inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
                  actionPending ? "opacity-70" : ""
                }`}
              >
                {actionPending ? "Indítás…" : "Jegyértékesítés indítása"}
              </button>
              <p className="mt-2 text-xs text-neutral-500">
                Indításhoz kell legalább egy mentett, aktív jegytípus és nem múltbeli dátum.
              </p>
            </div>
          )}
          {actionError && (
            <p role="alert" className="mt-3 break-words text-sm text-[#ed9a91]">
              {actionError}
            </p>
          )}
          {actionNotice && <p className="mt-3 text-sm text-[#86e3a0]">{actionNotice}</p>}
        </section>

        {/* Összegzés */}
        <section className="mb-4 rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
          <h3 className="font-display text-base font-bold text-neutral-100">Összegzés</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-neutral-border/70 bg-neutral-dark/50 p-3">
              <p className="text-xs uppercase tracking-wider text-neutral-400">Bevétel</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-neutral-100">
                {formatHuf(revenue)} Ft
              </p>
            </div>
            <div className="rounded-lg border border-neutral-border/70 bg-neutral-dark/50 p-3">
              <p className="text-xs uppercase tracking-wider text-neutral-400">Eladott jegy</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-neutral-100">{sold} db</p>
            </div>
          </div>
          {(ticketing?.types ?? []).filter((type) => type.active).length > 0 && (
            <div className="mt-4 space-y-2.5">
              {(ticketing?.types ?? [])
                .filter((type) => type.active)
                .map((type) => (
                  <div key={type.id}>
                    <p className="mb-1 flex items-baseline justify-between gap-2 text-xs text-neutral-300">
                      <span className="min-w-0 truncate">
                        {type.name} · {formatHuf(type.price_huf)} Ft
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {type.sold}{type.capacity !== null ? ` / ${type.capacity}` : ""} db
                      </span>
                    </p>
                    <StatBar sold={type.sold} capacity={type.capacity} />
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Rendelések */}
        <section className="mb-4 rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-base font-bold text-neutral-100">Rendelések</h3>
            {orders !== null && (
              <p className="text-xs text-neutral-500">{orders.length} db</p>
            )}
          </div>
          <div className="mt-3">
            {orders === null ? (
              <p className="text-sm text-neutral-400">A rendelések betöltése folyamatban…</p>
            ) : (
              <OrdersTable orders={orders} onVisszateritve={reloadOrders} />
            )}
          </div>
        </section>

        {/* Számlázás csempe */}
        <TacitoTile initial={initialStatus} variant="compact" />
      </main>
    </div>
  );
}
