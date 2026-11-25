"use client";

import { useState } from "react";

import { IconClose } from "@/components/icons";
import { formatHuf, type ApiTicketType, type TicketingInfo } from "./types";

/**
 * Ticket type editor of a concert. „Mentés” PUTs the full list to
 * /api/intern/koncertek/[id]/ticket-types: every row of the payload is
 * upserted (rows without an id are new — the server assigns the uuid),
 * rows missing from the payload are deactivated, never deleted.
 *
 * A blocked „Mentés” (empty list, missing name, a price that is neither 0 nor
 * at least 200 Ft, two early bird rows) is never a disabled button: it stays
 * clickable and explains itself inline on the click.
 */

type Row = {
  /** null → a new type; not sent in the payload (the server assigns the id). */
  id: string | null;
  name: string;
  price: string;
  capacity: string;
  kind: "standard" | "early_bird";
  active: boolean;
  sales_start: string | null;
  sales_end: string | null;
};

const inputClass =
  "w-full min-w-0 rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary";
const cellLabelClass = "block text-[11px] text-neutral-400 mb-1";

function rowFromType(type: ApiTicketType): Row {
  return {
    id: type.id,
    name: type.name,
    price: String(type.price_huf),
    capacity: type.capacity === null ? "" : String(type.capacity),
    kind: type.kind,
    active: type.active,
    sales_start: type.sales_start,
    sales_end: type.sales_end,
  };
}

export default function TicketTypeEditor({
  concertId,
  ticketing,
  onSaved,
}: {
  concertId: string;
  ticketing: TicketingInfo | null;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    ticketing?.types ? ticketing.types.map(rowFromType) : [],
  );
  const [errors, setErrors] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patchRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    if (errors) setErrors(null);
    setNotice(null);
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { id: null, name: "", price: "", capacity: "", kind: "standard", active: true, sales_start: null, sales_end: null },
    ]);
    if (errors) setErrors(null);
    setNotice(null);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
    if (errors) setErrors(null);
    setNotice(null);
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Inline validation, only on a real click.
    const problems: string[] = [];
    if (rows.length === 0) {
      problems.push("Legalább egy jegytípus szükséges a mentéshez.");
    }
    rows.forEach((row, index) => {
      const nth = `${index + 1}. jegytípus`;
      if (row.name.trim().length < 1) problems.push(`A ${nth} neve hiányzik.`);
      if (row.name.trim().length > 60) problems.push(`A ${nth} neve legfeljebb 60 karakter lehet.`);
      const price = Number(row.price.trim());
      if (!Number.isInteger(price) || (price !== 0 && price < 200)) {
        problems.push(`A ${nth} ára 0 forint (ingyenes) vagy legalább 200 forint, egész szám.`);
      }
      if (row.capacity.trim() !== "") {
        const capacity = Number(row.capacity.trim());
        if (!Number.isInteger(capacity) || capacity < 1) {
          problems.push(`A ${nth} férőhelye 1 vagy nagyobb egész szám, vagy üresen hagyható.`);
        }
      }
    });
    const earlyBirds = rows.filter((row) => row.kind === "early_bird");
    if (earlyBirds.length > 1) problems.push("Csak egy elővételes jegytípus lehet.");
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setErrors(null);
    setNotice(null);
    setSubmitting(true);

    fetch(`/api/intern/koncertek/${concertId}/ticket-types`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        types: rows.map((row, index) => ({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          kind: row.kind,
          price_huf: Number(row.price.trim()),
          capacity: row.capacity.trim() === "" ? null : Number(row.capacity.trim()),
          sales_start: row.sales_start,
          sales_end: row.sales_end,
          active: row.active,
          sort: index,
        })),
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { types?: ApiTicketType[]; error?: string }
          | null;
        if (!response.ok || !data?.types) {
          setSubmitting(false);
          setErrors([data?.error ?? "Nem sikerült menteni a jegytípusokat."]);
          return;
        }
        setRows(data.types.map(rowFromType));
        setSubmitting(false);
        setNotice("Jegytípusok mentve.");
        onSaved();
      })
      .catch(() => {
        setSubmitting(false);
        setErrors(["Nem sikerült menteni a jegytípusokat. Kérem, próbálja újra."]);
      });
  }

  return (
    <form onSubmit={handleSave} noValidate className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-neutral-100">Jegytípusok</h3>
        <button
          type="button"
          onClick={addRow}
          className="text-sm font-semibold text-primary transition-opacity hover:opacity-70"
        >
          Jegytípus hozzáadása
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">
          Még nincs jegytípus – adjon hozzá egyet a jegyértékesítés indításához.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {rows.map((row, index) => {
            const saved = ticketing?.types.find((type) => type.id === row.id);
            return (
              <div
                key={row.id ?? `new-${index}`}
                className="rounded-lg border border-neutral-border/80 bg-neutral-dark/40 p-3"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_130px_130px]">
                  <div className="col-span-2 sm:col-span-1">
                    <label className={cellLabelClass} htmlFor={`type-name-${index}`}>
                      Név
                    </label>
                    <input
                      id={`type-name-${index}`}
                      type="text"
                      value={row.name}
                      onChange={(e) => patchRow(index, { name: e.target.value })}
                      maxLength={60}
                      placeholder="Teljes árú jegy"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={cellLabelClass} htmlFor={`type-price-${index}`}>
                      Ár (Ft)
                    </label>
                    <input
                      id={`type-price-${index}`}
                      type="text"
                      inputMode="numeric"
                      value={row.price}
                      onChange={(e) => patchRow(index, { price: e.target.value.replace(/[^\d]/g, "") })}
                      placeholder="4000"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[10px] text-neutral-500">
                      0 forint = ingyenes jegy
                    </p>
                  </div>
                  <div>
                    <label className={cellLabelClass} htmlFor={`type-capacity-${index}`}>
                      Férőhely
                    </label>
                    <input
                      id={`type-capacity-${index}`}
                      type="text"
                      inputMode="numeric"
                      value={row.capacity}
                      onChange={(e) => patchRow(index, { capacity: e.target.value.replace(/[^\d]/g, "") })}
                      placeholder="–"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  {/* Fajta: segmented control (no native select). */}
                  <div
                    className="inline-flex rounded-lg border border-neutral-border bg-neutral-dark p-0.5"
                    role="group"
                    aria-label={`${index + 1}. jegytípus fajtája`}
                  >
                    {(["standard", "early_bird"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => patchRow(index, { kind })}
                        aria-pressed={row.kind === kind}
                        className={`rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                          row.kind === kind
                            ? "bg-primary text-[#0b1a10]"
                            : "text-neutral-300 hover:text-primary"
                        }`}
                      >
                        {kind === "standard" ? "Teljes árú jegy" : "Elővételes jegy"}
                      </button>
                    ))}
                  </div>

                  {/* Aktív on/off switch. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.active}
                    onClick={() => patchRow(index, { active: !row.active })}
                    className="flex items-center gap-2 text-xs text-neutral-300"
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        row.active ? "bg-primary" : "bg-neutral-border"
                      }`}
                    >
                      <span
                        className={`absolute size-3.5 rounded-full bg-charcoal transition-transform ${
                          row.active ? "translate-x-[19px]" : "translate-x-[3px]"
                        }`}
                      />
                    </span>
                    Aktív
                  </button>

                  <div className="flex items-center gap-3">
                    {saved && saved.sold > 0 && (
                      <span className="text-xs text-neutral-400">
                        Elkelt: {formatHuf(saved.sold)} db
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      aria-label={`${index + 1}. jegytípus eltávolítása`}
                      className="flex size-8 items-center justify-center rounded-full border border-neutral-border bg-neutral-dark text-neutral-300 transition-colors hover:border-[#ed9a91]/50 hover:text-[#ed9a91]"
                    >
                      <IconClose className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {errors && errors.length > 0 && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-[#ed9a91]/30 bg-[#ed9a91]/10 p-3 text-sm text-[#ed9a91]"
        >
          {errors.length === 1 ? (
            <p>{errors[0]}</p>
          ) : (
            <ul className="space-y-1">
              {errors.map((message) => (
                <li key={message}>• {message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && <p className="mt-3 text-sm text-[#86e3a0]">{notice}</p>}

      <button
        type="submit"
        className={`mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
          submitting ? "opacity-70" : ""
        }`}
      >
        {submitting ? "Mentés…" : "Mentés"}
      </button>
      <p className="mt-2 text-xs text-neutral-500">
        Az elvitt jegytípus kikapcsolva marad a listában (a rendelések miatt nem törölhető).
      </p>
    </form>
  );
}
