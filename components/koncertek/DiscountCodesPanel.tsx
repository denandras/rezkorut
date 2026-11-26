"use client";

import { useCallback, useEffect, useState } from "react";

import { formatHuf, formatTimestampHu, type ApiDiscountCode } from "./types";

/**
 * „Kedvezménykódok” panel (card 12) of the concert detail page and the
 * global list page. Create = POST /api/intern/kedvezmenykodok (Stripe coupon +
 * promotion code + DB row, created by the server); the list shows used/max
 * and an on/off switch per code (PATCH /api/intern/kedvezmenykodok/[id]).
 *
 * `concertId` filters the panel to ONE concert (its own codes plus the
 * minden-koncertre ones) and preselects that concert for new codes; omitting
 * it renders the global list (all codes, new codes default to minden
 * koncertre).
 *
 * Codes are immutable once created — the panel states the rule verbatim:
 * „A kód létrehozása után nem módosítható; kapcsolja ki és hozzon létre újat.”
 * A blocked „Kód létrehozása” never disables the button: it stays clickable
 * and explains itself inline on the click.
 */

const inputClass =
  "w-full min-w-0 rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary";
const labelClass = "block text-xs text-neutral-400 mb-1";

type Scope = "this" | "all";

export default function DiscountCodesPanel({
  concertId,
  concertTitle,
  initialCodes,
}: {
  concertId?: string;
  concertTitle?: string;
  initialCodes: ApiDiscountCode[] | null;
}) {
  const [codes, setCodes] = useState<ApiDiscountCode[] | null>(initialCodes);
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Create form state.
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [percent, setPercent] = useState("20");
  const [amount, setAmount] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scope, setScope] = useState<Scope>(concertId ? "this" : "all");

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/intern/kedvezmenykodok", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { codes?: ApiDiscountCode[]; error?: string }
        | null;
      if (!res.ok || !data?.codes) return;
      setCodes(data.codes);
    } catch {
      /* keep the last known state */
    }
  }, []);

  // Initial codes may arrive after mount (the page seeds the fetch).
  useEffect(() => {
    if (initialCodes === null) reload();
  }, [initialCodes, reload]);

  const visible = (codes ?? []).filter(
    (entry) => !concertId || entry.concert_id === null || entry.concert_id === concertId,
  );

  function resetForm() {
    setCode("");
    setMode("percent");
    setPercent("20");
    setAmount("");
    setMaxRedemptions("");
    setExpiresAt("");
    setScope(concertId ? "this" : "all");
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Inline validation, only on a real click — the server re-validates.
    const problems: string[] = [];
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,24}$/.test(normalized)) {
      problems.push("A kód 3–24 karakter lehet, csak nagybetű, szám és kötőjel.");
    }
    if (mode === "percent") {
      const value = Number(percent.trim());
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        problems.push("A százalékos kedvezmény 1 és 100 közötti egész szám lehet.");
      }
    } else {
      const value = Number(amount.trim());
      if (!Number.isInteger(value) || value < 100) {
        problems.push("Az összeg szerinti kedvezmény legalább 100 forint, egész szám.");
      }
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setErrors(null);
    setNotice(null);
    setSubmitting(true);

    fetch("/api/intern/kedvezmenykodok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: normalized,
        ...(mode === "percent"
          ? { percent_off: Number(percent.trim()) }
          : { amount_off_huf: Number(amount.trim()) }),
        ...(maxRedemptions.trim() === "" ? {} : { max_redemptions: Number(maxRedemptions.trim()) }),
        ...(expiresAt.trim() === ""
          ? {}
          : { expires_at: new Date(`${expiresAt.trim()}T23:59:59`).toISOString() }),
        concert_id: scope === "this" && concertId ? concertId : null,
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { code?: ApiDiscountCode; error?: string }
          | null;
        setSubmitting(false);
        if (!response.ok || !data?.code) {
          setErrors([data?.error ?? "Nem sikerült létrehozni a kedvezménykódot."]);
          return;
        }
        resetForm();
        setShowForm(false);
        setNotice(
          `Kedvezménykód létrehozva: ${data.code.code} (${data.code.stripe_coupon_id}, ${data.code.stripe_promotion_code_id}).`,
        );
        setCodes((current) => [data.code as ApiDiscountCode, ...(current ?? [])]);
      })
      .catch(() => {
        setSubmitting(false);
        setErrors(["Nem sikerült létrehozni a kedvezménykódot. Kérem, próbálja újra."]);
      });
  }

  function handleSwitch(entry: ApiDiscountCode) {
    if (switching !== null) return;
    setSwitching(entry.id);
    setErrors(null);
    setNotice(null);
    fetch(`/api/intern/kedvezmenykodok/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !entry.active }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { code?: ApiDiscountCode; error?: string }
          | null;
        setSwitching(null);
        if (!response.ok || !data?.code) {
          setErrors([data?.error ?? "Nem sikerült módosítani a kedvezménykódot."]);
          return;
        }
        setCodes((current) =>
          (current ?? []).map((row) => (row.id === entry.id ? (data.code as ApiDiscountCode) : row)),
        );
      })
      .catch(() => {
        setSwitching(null);
        setErrors(["Nem sikerült módosítani a kedvezménykódot. Kérem, próbálja újra."]);
      });
  }

  return (
    <section className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-neutral-100">Kedvezménykódok</h3>
        <button
          type="button"
          onClick={() => {
            setShowForm((open) => !open);
            setErrors(null);
            setNotice(null);
          }}
          className="text-sm font-semibold text-primary transition-opacity hover:opacity-70"
        >
          {showForm ? "Létrehozás bezárása" : "Kedvezménykód létrehozása"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} noValidate className="mt-3 rounded-lg border border-neutral-border/80 bg-neutral-dark/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="discount-code-input">
                Kód
              </label>
              <input
                id="discount-code-input"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={24}
                placeholder="TELJES20"
                className={inputClass}
              />
              <p className="mt-1 text-[10px] text-neutral-500">
                A vásárló ezt írja be — 3–24 karakter, nagybetű, szám, kötőjel.
              </p>
            </div>

            {/* Százalék vagy összeg: segmented control (no native select). */}
            <div>
              <span className={labelClass}>Kedvezmény</span>
              <div
                className="inline-flex rounded-lg border border-neutral-border bg-neutral-dark p-0.5"
                role="group"
                aria-label="Kedvezmény fajtája"
              >
                <button
                  type="button"
                  onClick={() => setMode("percent")}
                  aria-pressed={mode === "percent"}
                  className={`rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mode === "percent" ? "bg-primary text-[#0b1a10]" : "text-neutral-300 hover:text-primary"
                  }`}
                >
                  Százalék
                </button>
                <button
                  type="button"
                  onClick={() => setMode("amount")}
                  aria-pressed={mode === "amount"}
                  className={`rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mode === "amount" ? "bg-primary text-[#0b1a10]" : "text-neutral-300 hover:text-primary"
                  }`}
                >
                  Összeg (Ft)
                </button>
              </div>
              <div className="mt-2">
                {mode === "percent" ? (
                  <input
                    id="discount-percent-input"
                    type="text"
                    inputMode="numeric"
                    value={percent}
                    onChange={(event) => setPercent(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="20"
                    maxLength={3}
                    className={inputClass}
                    aria-label="Százalékos kedvezmény"
                  />
                ) : (
                  <input
                    id="discount-amount-input"
                    type="text"
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="1000"
                    maxLength={9}
                    className={inputClass}
                    aria-label="Összeg szerinti kedvezmény forintban"
                  />
                )}
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="discount-max-input">
                Max. beváltás
              </label>
              <input
                id="discount-max-input"
                type="text"
                inputMode="numeric"
                value={maxRedemptions}
                onChange={(event) => setMaxRedemptions(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="Korlátlan"
                maxLength={9}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="discount-expires-input">
                Lejárat
              </label>
              <input
                id="discount-expires-input"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                className={inputClass}
              />
            </div>

            {/* Melyik koncertre vagy mindenre: segmented control. */}
            <div className="sm:col-span-2">
              <span className={labelClass}>Érvényesség</span>
              {concertId ? (
                <div
                  className="inline-flex rounded-lg border border-neutral-border bg-neutral-dark p-0.5"
                  role="group"
                  aria-label="Melyik koncertre érvényes"
                >
                  <button
                    type="button"
                    onClick={() => setScope("this")}
                    aria-pressed={scope === "this"}
                    className={`max-w-full truncate rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                      scope === "this" ? "bg-primary text-[#0b1a10]" : "text-neutral-300 hover:text-primary"
                    }`}
                  >
                    {concertTitle ?? "Ez a koncert"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope("all")}
                    aria-pressed={scope === "all"}
                    className={`rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                      scope === "all" ? "bg-primary text-[#0b1a10]" : "text-neutral-300 hover:text-primary"
                    }`}
                  >
                    Minden koncertre
                  </button>
                </div>
              ) : (
                <p className="text-xs text-neutral-400">Minden koncertre (a koncert oldalán hozható létre koncertre szóló kód).</p>
              )}
            </div>
          </div>

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

          <button
            type="submit"
            className={`mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
              submitting ? "opacity-70" : ""
            }`}
          >
            {submitting ? "Létrehozás…" : "Kód létrehozása"}
          </button>
        </form>
      )}

      <div className="mt-3">
        {codes === null ? (
          <p className="text-sm text-neutral-400">A kedvezménykódok betöltése folyamatban…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-neutral-400">
            Még nincs kedvezménykód{concertId ? " ehhez a koncerthez" : ""}.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visible.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-neutral-border/80 bg-neutral-dark/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-wide text-white">{entry.code}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {entry.percent_off !== null
                        ? `${entry.percent_off}% kedvezmény`
                        : `${formatHuf(entry.amount_off_huf ?? 0)} Ft kedvezmény`}
                      {" · "}
                      {entry.concert_id === null ? "Minden koncertre" : entry.concert_title ?? entry.concert_id}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Beváltva: {entry.times_redeemed}
                      {entry.max_redemptions !== null ? ` / ${entry.max_redemptions}` : " (korlátlan)"}
                      {entry.expires_at
                        ? ` · Lejárat: ${formatTimestampHu(entry.expires_at)}`
                        : " · Nincs lejárat"}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entry.active}
                    aria-label={`${entry.code} ${entry.active ? "kikapcsolása" : "bekapcsolása"}`}
                    onClick={() => handleSwitch(entry)}
                    className={`flex items-center gap-2 text-xs text-neutral-300 ${
                      switching !== null ? "opacity-50" : ""
                    }`}
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        entry.active ? "bg-primary" : "bg-neutral-border"
                      }`}
                    >
                      <span
                        className={`absolute size-3.5 rounded-full bg-charcoal transition-transform ${
                          entry.active ? "translate-x-[19px]" : "translate-x-[3px]"
                        }`}
                      />
                    </span>
                    {entry.active ? "Aktív" : "Inaktív"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {notice && <p className="mt-3 break-words text-sm text-[#86e3a0]">{notice}</p>}
      {!showForm && errors && errors.length > 0 && (
        <p role="alert" className="mt-3 break-words text-sm text-[#ed9a91]">
          {errors[0]}
        </p>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        A kód létrehozása után nem módosítható; kapcsolja ki és hozzon létre újat.
      </p>
    </section>
  );
}
