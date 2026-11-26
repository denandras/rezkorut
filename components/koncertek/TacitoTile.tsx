"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TacitoStatus } from "./types";

/**
 * „Számlázás (TACITo)” tile.
 *
 * `variant="full"` — the health tile at the top of /intern/koncertek: status
 * dot + word (Rendben / Figyelem / Nem elérhető), the invoice series, the
 * pending/NAV-error/issued-today counts, and a „Frissítés” text button. No
 * auto-polling: one client re-fetch only when the server render could not get
 * the payload, plus the manual button.
 *
 * `variant="compact"` — the small tile on the concert detail page: pending
 * invoices + the last error, and a note that the cron retries automatically.
 *
 * The status endpoint never answers 5xx — it returns `{ok:false}` payloads
 * instead — but a network or parsing failure is still handled: the tile
 * degrades to „Nem elérhető” and never breaks the rest of the dashboard.
 */

function isHealthy(status: TacitoStatus): boolean {
  return status.ok && status.readiness.ready && status.readiness.nav_environment === "production";
}

/** The one line naming why the „Figyelem” state is not „Rendben”. */
function attentionLine(status: Extract<TacitoStatus, { ok: true }>): string {
  if (status.readiness.missing.length > 0) {
    return `Hiányzó lépés: ${status.readiness.missing[0].step}`;
  }
  if (status.readiness.nav_environment !== "production") {
    return "A NAV nincs éles (production) környezetre kapcsolva.";
  }
  if (status.series_mismatch) {
    return "Az ELOADO számlasorozat nincs beállítva alapértelmezettként.";
  }
  return "A TACITo fiók nincs teljesen beállítva.";
}

type DotTone = "ok" | "attention" | "unavailable";
const DOT_CLASS: Record<DotTone, string> = {
  ok: "bg-[#86e3a0]",
  attention: "bg-[#e6be5f]",
  unavailable: "bg-neutral-500",
};

function StatusWord({ tone, children }: { tone: DotTone; children: React.ReactNode }) {
  const wordClass =
    tone === "ok"
      ? "text-[#86e3a0]"
      : tone === "attention"
        ? "text-[#e6be5f]"
        : "text-neutral-400";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden="true" />
      <span className={`text-sm font-semibold ${wordClass}`}>{children}</span>
    </span>
  );
}

export default function TacitoTile({
  initial,
  variant = "full",
  onNavErrors,
}: {
  initial: TacitoStatus | null;
  variant?: "full" | "compact";
  onNavErrors?: () => void;
}) {
  const [status, setStatus] = useState<TacitoStatus | null>(initial);
  const [loading, setLoading] = useState(false);
  const triedInitialFetch = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intern/tacito/status", { cache: "no-store" });
      if (!res.ok) {
        setStatus(null);
        return;
      }
      setStatus((await res.json()) as TacitoStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The server render could not get a payload → try once from the client.
    // No polling loop in either case.
    if (initial === null && !triedInitialFetch.current) {
      triedInitialFetch.current = true;
      refresh();
    }
  }, [initial, refresh]);

  if (variant === "compact") {
    const pending = status?.ok ? status.counts.pending_tickets : null;
    const navErrors = status?.ok ? status.counts.nav_error_tickets : null;
    const lastError = status?.ok ? status.last_error : null;
    return (
      <div className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-neutral-100">
          Számlázás (TACITo)
        </h3>
        <p className="mt-2 text-sm text-neutral-300">
          Számlázásra vár:{" "}
          <span className="font-semibold text-neutral-100">{pending ?? "–"}</span>
        </p>
        <p className="mt-1 text-sm text-neutral-300">
          NAV hiba: <span className="font-semibold text-neutral-100">{navErrors ?? "–"}</span>
        </p>
        {lastError && (
          <p className="mt-2 break-words text-xs text-[#e6be5f]">
            Utolsó hiba ({lastError.ticket_code}): {lastError.message}
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          A számlázást a cron automatikusan újrapróbálja, kézi újrapróbálás nem szükséges.
        </p>
      </div>
    );
  }

  const healthy = status !== null && isHealthy(status);
  const tone: DotTone = status === null ? "unavailable" : healthy ? "ok" : status.ok ? "attention" : "unavailable";

  const series =
    status?.ok && (status.series.name || status.series.prefix)
      ? `${status.series.name ?? ""} ${status.series.prefix ?? ""}`.trim()
      : null;

  return (
    <div className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-neutral-100">
            Számlázás (TACITo)
          </h2>
          <StatusWord tone={tone}>
            {tone === "ok" ? "Rendben" : tone === "attention" ? "Figyelem" : "Nem elérhető"}
          </StatusWord>
        </div>
        <button
          type="button"
          onClick={refresh}
          className={`shrink-0 text-sm font-semibold text-primary transition-opacity hover:opacity-70 ${
            loading ? "opacity-50" : ""
          }`}
        >
          Frissítés
        </button>
      </div>

      <div className="mt-3 space-y-1 text-sm text-neutral-300">
        <p>
          Sorozat: <span className="font-semibold text-neutral-100">{series ?? "–"}</span>
        </p>
        <p>
          Számlázásra vár:{" "}
          <span className="font-semibold text-neutral-100">
            {status?.ok ? status.counts.pending_tickets : "–"}
          </span>
        </p>
        <p>
          NAV hiba:{" "}
          {status?.ok && status.counts.nav_error_tickets > 0 && onNavErrors ? (
            <button
              type="button"
              onClick={onNavErrors}
              className="font-semibold text-[#e6be5f] underline underline-offset-2 transition-opacity hover:opacity-70"
            >
              {status.counts.nav_error_tickets} – rendelések megnyitása
            </button>
          ) : (
            <span className="font-semibold text-neutral-100">
              {status?.ok ? status.counts.nav_error_tickets : "–"}
            </span>
          )}
        </p>
        <p>
          Ma kiállítva:{" "}
          <span className="font-semibold text-neutral-100">
            {status?.ok ? status.counts.issued_today : "–"}
          </span>
        </p>
      </div>

      {status && !status.ok && (
        <p className="mt-2 break-words text-xs text-neutral-500">{status.error}</p>
      )}
      {status?.ok && !healthy && (
        <p className="mt-2 break-words text-xs text-[#e6be5f]">{attentionLine(status)}</p>
      )}
    </div>
  );
}
