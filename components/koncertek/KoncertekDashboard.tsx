"use client";

import { useCallback, useState } from "react";

import BottomNav from "@/components/bottom-nav";
import ConcertForm from "./ConcertForm";
import ConcertList from "./ConcertList";
import OrdersTable from "./OrdersTable";
import TacitoTile from "./TacitoTile";
import type { ApiConcert, ApiOrder, TacitoStatus } from "./types";

/**
 * Client half of /intern/koncertek. The server page renders this component
 * with the API payloads it fetched (cookie-gated); every mutation
 * (create/edit/delete) re-reads GET /api/intern/koncertek — the card 02 API
 * is the only data source, never Supabase with the anon key.
 *
 * The health tile's „NAV hiba” count opens the orders list filtered to NAV
 * errors: orders are per-concert on the API, so the filter fetches the orders
 * of every concert that has any, and shows the errored ones in one list.
 */
export default function KoncertekDashboard({
  initialConcerts,
  initialStatus,
}: {
  initialConcerts: ApiConcert[] | null;
  initialStatus: TacitoStatus | null;
}) {
  const [concerts, setConcerts] = useState<ApiConcert[] | null>(initialConcerts);
  const [loadError, setLoadError] = useState(initialConcerts === null);
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editing, setEditing] = useState<ApiConcert | null>(null);
  const [navErrorFilter, setNavErrorFilter] = useState(false);
  const [navErrorOrders, setNavErrorOrders] = useState<ApiOrder[] | null>(null);
  const [navErrorLoading, setNavErrorLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/intern/koncertek", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { concerts?: ApiConcert[]; error?: string }
        | null;
      if (!res.ok || !data?.concerts) {
        setLoadError(true);
        return;
      }
      setConcerts(data.concerts);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  async function openNavErrors() {
    setNavErrorFilter(true);
    if (concerts === null) return;
    setNavErrorLoading(true);
    try {
      const withOrders = (concerts ?? []).filter(
        (concert) => concert.id && concert.ticketing && concert.ticketing.orders_count > 0,
      );
      const results = await Promise.all(
        withOrders.map(async (concert) => {
          const res = await fetch(`/api/intern/koncertek/${concert.id}/orders`, {
            cache: "no-store",
          });
          if (!res.ok) return [];
          const data = (await res.json().catch(() => null)) as { orders?: ApiOrder[] } | null;
          return data?.orders ?? [];
        }),
      );
      setNavErrorOrders(results.flat());
    } catch {
      setNavErrorOrders([]);
    } finally {
      setNavErrorLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background-dark">
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
        {/* Vissza link + cím + Új koncert */}
        <div className="mb-2">
          <a
            href="/intern"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza az internhez
          </a>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-xl font-bold text-neutral-100">Koncertek</h1>
          <button
            type="button"
            onClick={() => {
              setFormMode(formMode === "create" ? "closed" : "create");
              setEditing(null);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90"
          >
            {formMode === "create" ? "Új koncert bezárása" : "Új koncert"}
          </button>
        </div>

        {/* Egészség-csempe */}
        <div className="mb-4">
          <TacitoTile initial={initialStatus} onNavErrors={openNavErrors} />
        </div>

        {/* NAV hibás rendelések szűrőnézet */}
        {navErrorFilter && (
          <section className="mb-4 rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-neutral-100">
                NAV hibás rendelések
              </h2>
              <button
                type="button"
                onClick={() => {
                  setNavErrorFilter(false);
                  setNavErrorOrders(null);
                }}
                className="text-sm text-neutral-400 transition-colors hover:text-primary"
              >
                Bezárás
              </button>
            </div>
            <div className="mt-3">
              {navErrorLoading ? (
                <p className="text-sm text-neutral-400">Betöltés…</p>
              ) : (
                <OrdersTable orders={navErrorOrders ?? []} navErrorOnly />
              )}
            </div>
          </section>
        )}

        {/* Új koncert / szerkesztés űrlap */}
        {formMode !== "closed" && (
          <div className="mb-4">
            <ConcertForm
              concert={formMode === "edit" ? editing : null}
              onSaved={() => {
                setFormMode("closed");
                setEditing(null);
                reload();
              }}
              onDeleted={() => {
                setFormMode("closed");
                setEditing(null);
                reload();
              }}
              onClose={() => {
                setFormMode("closed");
                setEditing(null);
              }}
            />
          </div>
        )}

        {/* Koncertlista */}
        {concerts === null ? (
          <p className="text-sm text-neutral-400">A koncertek betöltése folyamatban…</p>
        ) : loadError ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[#ed9a91]">
              Nem sikerült betölteni a koncerteket. Kérem, próbálja újra.
            </p>
            <button
              type="button"
              onClick={reload}
              className="self-start rounded-lg border border-neutral-border bg-neutral-dark px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-primary/50 hover:text-primary"
            >
              Újratöltés
            </button>
          </div>
        ) : (
          <ConcertList
            concerts={concerts}
            onEdit={(concert) => {
              setEditing(concert);
              setFormMode("edit");
              window.scrollTo(0, 0);
            }}
          />
        )}
      </main>
      <BottomNav active="none" />
    </div>
  );
}
