"use client";

import { useState } from "react";

import { IconClose } from "@/components/icons";
import { huDateToIso, type ApiConcert } from "./types";

/**
 * Create/edit concert form. Create mode POSTs /api/intern/koncertek, edit
 * mode PATCHes /api/intern/koncertek/[id] — the same routes the ConcertList
 * and the detail screen open it from.
 *
 * Standing rules: errors appear inline only after a failed click (never
 * pre-emptively); the delete is a two-click confirm, no confirm(); the date
 * is a text input in the file's Hungarian format, validated on save.
 */

const inputClass =
  "w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary";
const labelClass = "block text-xs text-neutral-400 mb-1";

type Props = {
  /** The concert being edited; null in create mode. */
  concert?: ApiConcert | null;
  onSaved: (id: string | null) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
};

export default function ConcertForm({ concert, onSaved, onDeleted, onClose }: Props) {
  const editMode = Boolean(concert?.id);
  const [date, setDate] = useState(concert?.date ?? "");
  const [time, setTime] = useState(concert?.time ?? "");
  const [title, setTitle] = useState(concert?.title ?? "");
  const [location, setLocation] = useState(concert?.location ?? "");
  const [venue, setVenue] = useState(concert?.venue ?? "");
  const [program, setProgram] = useState<string[]>(
    concert?.program && concert.program.length > 0 ? [...concert.program] : [""],
  );
  const [href, setHref] = useState(concert?.link?.href ?? "");
  const [hrefLabel, setHrefLabel] = useState(
    concert?.link && concert.link.label !== "Jegyinfo" ? concert.link.label : "",
  );
  const [errors, setErrors] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function setProgramRow(index: number, value: string) {
    setProgram((rows) => rows.map((row, i) => (i === index ? value : row)));
    if (errors) setErrors(null);
  }

  function clearError() {
    if (errors) setErrors(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Validation only runs on a real click — never pre-emptively.
    const missing: string[] = [];
    if (title.trim().length < 1) missing.push("A cím megadása kötelező.");
    if (!huDateToIso(date)) {
      missing.push("Értelmezhetetlen dátum (példa: 2026. december 12. vagy 2026-12-12).");
    }
    if (!location.trim() && !venue.trim()) {
      missing.push("Legalább a helyszín vagy a terem megadása szükséges.");
    }
    if (href.trim() && href.trim().length > 500) {
      missing.push("A jegyinfo link túl hosszú (legfeljebb 500 karakter).");
    }
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors(null);
    setSubmitting(true);

    const body = {
      date: date.trim(),
      time: time.trim(),
      location: location.trim(),
      venue: venue.trim(),
      title: title.trim(),
      program: program.map((row) => row.trim()).filter((row) => row.length > 0),
      href: href.trim(),
      href_label: hrefLabel.trim(),
    };

    fetch(editMode ? `/api/intern/koncertek/${concert?.id}` : "/api/intern/koncertek", {
      method: editMode ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { concert?: { id?: string }; error?: string }
          | null;
        if (!response.ok || !data?.concert?.id) {
          setSubmitting(false);
          setErrors([data?.error ?? "Nem sikerült menteni a koncertet."]);
          return;
        }
        onSaved(data.concert.id ?? null);
      })
      .catch(() => {
        setSubmitting(false);
        setErrors(["Nem sikerült menteni a koncertet. Kérem, próbálja újra."]);
      });
  }

  function handleDelete() {
    if (!concert?.id) return;
    if (!deleteArmed) {
      setDeleteArmed(true); // first click: arm
      return;
    }
    if (deleting) return;
    setDeleting(true);
    fetch(`/api/intern/koncertek/${concert.id}`, { method: "DELETE" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          setDeleting(false);
          setDeleteArmed(false);
          setErrors([data?.error ?? "Nem sikerült törölni a koncertet."]);
          return;
        }
        onDeleted?.(concert.id as string);
      })
      .catch(() => {
        setDeleting(false);
        setDeleteArmed(false);
        setErrors(["Nem sikerült törölni a koncertet. Kérem, próbálja újra."]);
      });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-neutral-100">
          {editMode ? "Koncert szerkesztése" : "Új koncert"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm text-neutral-400 transition-colors hover:text-primary"
        >
          Mégse
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="concert-date">
            Dátum
          </label>
          <input
            id="concert-date"
            type="text"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              clearError();
            }}
            maxLength={40}
            placeholder="2026. december 12."
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="concert-time">
            Időpont
          </label>
          <input
            id="concert-time"
            type="text"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              clearError();
            }}
            maxLength={30}
            placeholder="19:00"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="concert-title">
            Cím
          </label>
          <input
            id="concert-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError();
            }}
            maxLength={200}
            placeholder="Réz körút koncert"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="concert-location">
            Helyszín
          </label>
          <input
            id="concert-location"
            type="text"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              clearError();
            }}
            maxLength={200}
            placeholder="Budapest"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="concert-venue">
            Terem
          </label>
          <input
            id="concert-venue"
            type="text"
            value={venue}
            onChange={(e) => {
              setVenue(e.target.value);
              clearError();
            }}
            maxLength={200}
            placeholder="BMC Könyvtár"
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-4">
        <span className={labelClass}>Műsor (egy sor = egy tétel)</span>
        <div className="flex flex-col gap-2">
          {program.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={row}
                onChange={(e) => setProgramRow(index, e.target.value)}
                maxLength={200}
                placeholder={index === 0 ? "Liszt: Hunyadi László" : "Következő tétel"}
                aria-label={`${index + 1}. műsortétel`}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => {
                  setProgram((rows) => rows.filter((_, i) => i !== index));
                  if (errors) setErrors(null);
                }}
                aria-label={`${index + 1}. műsortétel eltávolítása`}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-border bg-neutral-dark text-neutral-300 transition-colors hover:border-primary/50 hover:text-primary"
              >
                <IconClose className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setProgram((rows) => [...rows, ""]);
            if (errors) setErrors(null);
          }}
          className="mt-2 text-sm font-semibold text-primary transition-opacity hover:opacity-70"
        >
          Tétel hozzáadása
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_minmax(140px,240px)]">
        <div>
          <label className={labelClass} htmlFor="concert-href">
            Jegyinfo link (nem kötelező)
          </label>
          <input
            id="concert-href"
            type="text"
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              clearError();
            }}
            maxLength={500}
            placeholder="https://…"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="concert-href-label">
            Link felirata
          </label>
          <input
            id="concert-href-label"
            type="text"
            value={hrefLabel}
            onChange={(e) => {
              setHrefLabel(e.target.value);
              clearError();
            }}
            maxLength={60}
            placeholder="Jegyinfo"
            className={inputClass}
          />
        </div>
      </div>

      {errors && errors.length > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[#ed9a91]/30 bg-[#ed9a91]/10 p-3 text-sm text-[#ed9a91]"
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

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          className={`inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
            submitting ? "opacity-70" : ""
          }`}
        >
          {submitting ? "Mentés…" : editMode ? "Módosítások mentése" : "Koncert létrehozása"}
        </button>
        {editMode && (
          <div className="flex items-center gap-2">
            {deleteArmed && (
              <button
                type="button"
                onClick={() => setDeleteArmed(false)}
                className="text-sm text-neutral-400 transition-colors hover:text-primary"
              >
                Mégse
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                deleteArmed
                  ? "border-[#ed9a91]/60 bg-[#ed9a91]/10 text-[#ed9a91]"
                  : "border-neutral-border bg-neutral-dark text-neutral-300 hover:border-[#ed9a91]/50 hover:text-[#ed9a91]"
              }`}
            >
              {deleteArmed ? (deleting ? "Törlés…" : "Biztos törlés?") : "Koncert törlése"}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
