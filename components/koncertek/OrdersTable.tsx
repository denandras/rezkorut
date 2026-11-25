"use client";

import { useState } from "react";

import { formatHuf, formatTimestampHu, type ApiOrder, type ApiTicket } from "./types";

/**
 * Orders of a concert: time, buyer, e-mail, ticket count, amount, the
 * invoice number + NAV state (or „Számlázásra vár” / the error text), and the
 * owner's refund path. Refunding is a two-click confirm — the label declares
 * the only two legal reasons (concert cancelled or materially moved), and
 * the reason is chosen in the confirm step: there is no buyer-requested
 * refund, the ticket is transferable instead.
 *
 * `navErrorOnly` renders only orders with a NAV error (the health tile's
 * „NAV hiba” count opens this view).
 */

/** True when any ticket of the order carries a NAV error. */
export function orderHasNavError(order: ApiOrder): boolean {
  return order.tickets.some(
    (ticket) => ticket.tacito_error || ticket.tacito_nav_outcome === "ERROR",
  );
}

function navOutcomeWord(outcome: string | null): string {
  switch (outcome) {
    case "ACCEPTED":
      return "NAV: rendben";
    case "ERROR":
      return "NAV: hiba";
    case "PENDING":
      return "NAV: folyamatban";
    case "NOT_CONFIGURED":
      return "NAV: nincs beállítva";
    default:
      return "";
  }
}

function invoiceState(tickets: ApiTicket[]): { text: string; tone: "ok" | "warn" | "err" } {
  const errored = tickets.find((ticket) => ticket.tacito_error);
  if (errored) {
    return { text: errored.tacito_error ?? "Számlázási hiba", tone: "err" };
  }
  const numbered = tickets.filter((ticket) => ticket.tacito_invoice_number);
  if (tickets.length > 0 && numbered.length === tickets.length) {
    const first = numbered[0]?.tacito_invoice_number ?? "";
    const extra = numbered.length > 1 ? ` (+${numbered.length - 1})` : "";
    const nav = navOutcomeWord(numbered[0]?.tacito_nav_outcome ?? null);
    return {
      text: `${first}${extra}${nav ? ` · ${nav}` : ""}`,
      tone: "ok",
    };
  }
  if (tickets.some((ticket) => ticket.tacito_invoice_number)) {
    return { text: "Számla készítés alatt", tone: "warn" };
  }
  return { text: "Számlázásra vár", tone: "warn" };
}

type VisszateritesState =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "done"; note: string }
  | { step: "error"; message: string };

function VisszateritesControl({ order, onVisszateritve }: { order: ApiOrder; onVisszateritve: () => void }) {
  const [state, setState] = useState<VisszateritesState>({ step: "idle" });
  const [submitting, setSubmitting] = useState(false);

  function visszaterit(reason: "cancelled" | "moved") {
    if (submitting) return;
    setSubmitting(true);
    fetch(`/api/intern/orders/${order.id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; note?: string; error?: string }
          | null;
        setSubmitting(false);
        if (!response.ok || !data?.ok) {
          setState({ step: "error", message: data?.error ?? "Nem sikerült a visszatérítés." });
          return;
        }
        setState({ step: "done", note: data.note ?? "A rendelés visszatérítésre került." });
        onVisszateritve();
      })
      .catch(() => {
        setSubmitting(false);
        setState({ step: "error", message: "Nem sikerült a visszatérítés. Kérem, próbálja újra." });
      });
  }

  if (state.step === "done") {
    return <p className="text-sm text-[#86e3a0]">Visszatérítve. {state.note}</p>;
  }

  if (state.step === "confirm") {
    return (
      <div className="rounded-lg border border-[#e6be5f]/40 bg-[#e6be5f]/10 p-3">
        <p className="text-sm font-semibold text-[#e6be5f]">
          Visszatérítés – koncert elmaradt / elmozdult
        </p>
        <p className="mt-1 text-xs text-neutral-300">Miért téríti vissza a rendelést?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => visszaterit("cancelled")}
            className={`rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-xs font-semibold text-neutral-100 transition-colors hover:border-[#ed9a91]/50 hover:text-[#ed9a91] ${
              submitting ? "opacity-50" : ""
            }`}
          >
            Elmaradt
          </button>
          <button
            type="button"
            onClick={() => visszaterit("moved")}
            className={`rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-xs font-semibold text-neutral-100 transition-colors hover:border-[#ed9a91]/50 hover:text-[#ed9a91] ${
              submitting ? "opacity-50" : ""
            }`}
          >
            Elmozdult
          </button>
          <button
            type="button"
            onClick={() => setState({ step: "idle" })}
            className="px-2 py-2 text-xs text-neutral-400 transition-colors hover:text-primary"
          >
            Mégse
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setState({ step: "confirm" })}
        className="text-sm text-neutral-300 underline underline-offset-2 transition-colors hover:text-[#ed9a91]"
      >
        Visszatérítés – koncert elmaradt / elmozdult
      </button>
      {state.step === "error" && <p className="text-xs text-[#ed9a91]">{state.message}</p>}
    </div>
  );
}

const orderStatusWord: Record<ApiOrder["status"], string> = {
  pending: "Fizetésre vár",
  paid: "Kifizetve",
  refunded: "Visszatérítve",
  expired: "Lejárt",
  failed: "Sikertelen",
};

export default function OrdersTable({
  orders,
  navErrorOnly = false,
  onVisszateritve,
}: {
  orders: ApiOrder[];
  navErrorOnly?: boolean;
  onVisszateritve?: () => void;
}) {
  const visible = navErrorOnly ? orders.filter(orderHasNavError) : orders;

  if (visible.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        {navErrorOnly ? "Nincs NAV hibás rendelés." : "Még nincs rendelés ehhez a koncerthez."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {visible.map((order) => {
        const invoice = invoiceState(order.tickets);
        return (
          <article
            key={order.id}
            className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4"
          >
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {formatTimestampHu(order.created_at)}
              </p>
              <p className="text-sm font-semibold tabular-nums text-neutral-100">
                {formatHuf(order.amount_huf)} Ft
              </p>
            </div>

            <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <p className="min-w-0 truncate text-sm text-neutral-100">
                {order.buyer_name ?? "Névtelen"}
              </p>
              <p className="min-w-0 truncate text-xs text-neutral-400">{order.buyer_email ?? "–"}</p>
            </div>

            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-xs text-neutral-300">
                {order.tickets.length} jegy · {orderStatusWord[order.status]}
              </p>
              <p
                className={`min-w-0 break-all text-xs ${
                  invoice.tone === "ok"
                    ? "text-[#86e3a0]"
                    : invoice.tone === "err"
                      ? "text-[#ed9a91]"
                      : "text-[#e6be5f]"
                }`}
              >
                {invoice.text}
              </p>
            </div>

            {order.status === "paid" && (
              <div className="mt-3">
                <VisszateritesControl order={order} onVisszateritve={() => onVisszateritve?.()} />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
