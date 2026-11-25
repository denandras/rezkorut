"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { PublicTicketType } from "@/lib/tickets-public";

/**
 * Public buy form (card 05, free types in card 11). The quantities, buyer
 * fields and the total are validated client-side with inline messages — but
 * the primary button is NEVER disabled: a blocked action stays clickable,
 * dims slightly and says what is missing on a real click (owner's standing
 * rule). The server re-validates everything and recomputes the amount from
 * the DB.
 *
 * Private buyers only (owner decision 2026-11-25): no company name, no tax
 * number, no company toggle — those fields do not exist here.
 *
 * Card 11: a 0 Ft type is an ingyenes jegy — it has its own request path
 * (POST /api/tickets/free, no payment step, no card fields), so the page
 * renders TWO independent forms: the paid cart (unchanged) and, when free
 * types exist, a compact free block with a single „Jegy igénylése” button
 * per type. Mixing free and paid types in one purchase is forbidden — the
 * server answers 409, the UI simply offers no way to mix. A free-only
 * concert renders ONLY the free block.
 *
 * Mirrors of the server-side limits in lib/ticket-checkout.ts and
 * app/api/tickets/free/route.ts.
 */
const PER_TYPE_MAX = 4;
const TOTAL_MAX = 6;
const FREE_PER_TYPE_MAX = 2;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Deterministic HU price formatting (no locale drift between SSR and client). */
function formatHuf(amount: number): string {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

const inputClass =
  "w-full rounded-lg border border-neutral-border bg-neutral-dark px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary";
const labelClass = "block text-xs text-neutral-400 mb-1";

function StepperButton({
  onClick,
  label,
  dim,
  children,
}: {
  onClick: () => void;
  label: string;
  dim?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-border bg-neutral-dark text-base font-semibold text-neutral-100 transition-colors hover:border-primary/50 hover:text-primary ${
        dim ? "opacity-40" : ""
      }`}
    >
      {children}
    </button>
  );
}

export default function BuyForm({
  concertId,
  types,
}: {
  concertId: string;
  types: PublicTicketType[];
}) {
  const freeTypes = useMemo(() => types.filter((type) => type.price_huf === 0), [types]);
  const paidTypes = useMemo(() => types.filter((type) => type.price_huf > 0), [types]);

  // --- Paid cart state (unchanged flow) ---
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [invoiceByEmail, setInvoiceByEmail] = useState(true);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Free request state (card 11) ---
  const [freeQuantities, setFreeQuantities] = useState<Record<string, number>>({});
  const [freeName, setFreeName] = useState("");
  const [freeEmail, setFreeEmail] = useState("");
  const [freeAcceptTerms, setFreeAcceptTerms] = useState(false);
  const [freeErrors, setFreeErrors] = useState<string[] | null>(null);
  const [freeSubmitting, setFreeSubmitting] = useState<string | null>(null);

  const total = useMemo(
    () => Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0),
    [quantities],
  );
  const totalPrice = useMemo(
    () =>
      paidTypes.reduce(
        (sum, type) => sum + (quantities[type.id] ?? 0) * type.price_huf,
        0,
      ),
    [paidTypes, quantities],
  );

  function setQuantity(typeId: string, next: number) {
    setQuantities((current) => ({ ...current, [typeId]: Math.max(0, next) }));
  }

  function step(type: PublicTicketType, direction: 1 | -1) {
    const current = quantities[type.id] ?? 0;
    if (direction === -1) {
      setQuantity(type.id, current - 1);
      return;
    }
    const cap = Math.min(PER_TYPE_MAX, type.remaining ?? PER_TYPE_MAX);
    if (current >= cap || total >= TOTAL_MAX) return;
    setQuantity(type.id, current + 1);
  }

  function setFreeQuantity(typeId: string, next: number) {
    setFreeQuantities((current) => ({ ...current, [typeId]: next }));
  }

  function freeStep(type: PublicTicketType, direction: 1 | -1) {
    const cap = Math.min(FREE_PER_TYPE_MAX, type.remaining ?? FREE_PER_TYPE_MAX);
    const current = freeQuantities[type.id] ?? 1;
    setFreeQuantity(type.id, Math.min(cap, Math.max(1, current + direction)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Everything is explained inline after a real click — never pre-emptively,
    // never by disabling the button.
    const missing: string[] = [];
    if (total === 0) missing.push("Válasszon legalább egy jegyet.");
    if (name.trim().length < 2) missing.push("A név megadása kötelező.");
    if (!EMAIL_RE.test(email.trim())) missing.push("Érvényes e-mail-cím megadása kötelező.");
    if (postalCode.trim().length === 0) missing.push("Az irányítószám megadása kötelező.");
    if (city.trim().length === 0) missing.push("A város megadása kötelező.");
    if (street.trim().length === 0) missing.push("Az utca, házszám megadása kötelező.");
    if (!acceptTerms) missing.push("A vásárlási feltételek elfogadása kötelező.");
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors(null);
    setSubmitting(true);

    fetch("/api/tickets/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concert_id: concertId,
        items: paidTypes
          .filter((type) => (quantities[type.id] ?? 0) > 0)
          .map((type) => ({
            ticket_type_id: type.id,
            quantity: quantities[type.id] ?? 0,
          })),
        buyer: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: {
            postal_code: postalCode.trim(),
            city: city.trim(),
            street: street.trim(),
          },
        },
        accept_terms: true,
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { url?: string; message?: string }
          | null;
        if (!response.ok || !data?.url) {
          setSubmitting(false);
          setErrors([data?.message ?? "Nem sikerült elindítani a fizetést."]);
          return;
        }
        window.location.assign(data.url);
      })
      .catch(() => {
        setSubmitting(false);
        setErrors(["Nem sikerült elindítani a fizetést. Kérem, próbálja újra."]);
      });
  }

  /**
   * „Jegy igénylése” — the free request for one type. No payment step, no
   * card fields: the server creates the order, the tickets and the e-mail
   * synchronously and answers with a signed confirmation token.
   */
  function requestFreeTickets(type: PublicTicketType) {
    if (freeSubmitting !== null) return;

    const quantity = Math.min(
      Math.max(1, freeQuantities[type.id] ?? 1),
      Math.min(FREE_PER_TYPE_MAX, type.remaining ?? FREE_PER_TYPE_MAX),
    );
    const missing: string[] = [];
    if (freeName.trim().length < 2) missing.push("A név megadása kötelező.");
    if (!EMAIL_RE.test(freeEmail.trim())) missing.push("Érvényes e-mail-cím megadása kötelező.");
    if (!freeAcceptTerms) missing.push("A vásárlási feltételek elfogadása kötelező.");
    if (missing.length > 0) {
      setFreeErrors(missing);
      return;
    }
    setFreeErrors(null);
    setFreeSubmitting(type.id);

    fetch("/api/tickets/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concert_id: concertId,
        ticket_type_id: type.id,
        quantity,
        buyer: { name: freeName.trim(), email: freeEmail.trim() },
        accept_terms: true,
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { token?: string; message?: string }
          | null;
        if (!response.ok) {
          setFreeSubmitting(null);
          setFreeErrors([data?.message ?? "Nem sikerült igényelni a jegyet. Kérem, próbálja újra."]);
          return;
        }
        window.location.assign(
          data?.token
            ? `/jegyek/koszonjuk?order=${encodeURIComponent(data.token)}`
            : "/jegyek/koszonjuk",
        );
      })
      .catch(() => {
        setFreeSubmitting(null);
        setFreeErrors(["Nem sikerült igényelni a jegyet. Kérem, próbálja újra."]);
      });
  }

  const nameInvalid = name.trim().length < 2;
  const emailInvalid = !EMAIL_RE.test(email.trim());
  const postalInvalid = postalCode.trim().length === 0;
  const cityInvalid = city.trim().length === 0;
  const streetInvalid = street.trim().length === 0;
  const attempted = errors !== null;
  const fieldClass = (invalid: boolean) =>
    `${inputClass}${attempted && invalid ? " border-[#ed9a91]/60" : ""}`;

  const freeNameInvalid = freeName.trim().length < 2;
  const freeEmailInvalid = !EMAIL_RE.test(freeEmail.trim());
  const freeAttempted = freeErrors !== null;
  const freeFieldClass = (invalid: boolean) =>
    `${inputClass}${freeAttempted && invalid ? " border-[#ed9a91]/60" : ""}`;

  return (
    <div className="flex flex-col gap-8">
      {/* --------------------------------------------------------------- */}
      {/* Fizetős jegyek — the paid cart, unchanged (hidden when the        */}
      {/* concert has no paid type)                                        */}
      {/* --------------------------------------------------------------- */}
      {paidTypes.length > 0 && (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
          {/* Jegytípusok */}
          <section>
            <h3 className="font-display text-xl font-bold tracking-tight text-white">
              Jegyek
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              EGY VÁSÁRLÁSBAN LEGFELJEBB 6 JEGY, JEGYTÍPUSONKÉNT LEGFELJEBB 4.
            </p>
            <div className="mt-3 space-y-3">
              {paidTypes.map((type) => {
                const soldOut = type.remaining === 0;
                const quantity = quantities[type.id] ?? 0;
                return (
                  <div
                    key={type.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{type.name}</p>
                      <p className="mt-1 text-sm text-neutral-300">
                        {formatHuf(type.price_huf)} Ft
                        {type.remaining !== null && (
                          <span className="text-neutral-500">
                            {" · "}
                            {soldOut ? "Elfogyott" : `Még ${type.remaining} db`}
                          </span>
                        )}
                      </p>
                    </div>
                    {soldOut ? (
                      <span className="shrink-0 rounded-full bg-neutral-border/60 px-3 py-1.5 text-xs font-semibold text-neutral-300">
                        Elfogyott
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <StepperButton
                          onClick={() => step(type, -1)}
                          label={`Kevesebb: ${type.name}`}
                          dim={quantity === 0}
                        >
                          −
                        </StepperButton>
                        <span className="w-6 text-center text-base font-semibold text-white tabular-nums">
                          {quantity}
                        </span>
                        <StepperButton
                          onClick={() => step(type, 1)}
                          label={`Több: ${type.name}`}
                          dim={
                            quantity >= Math.min(PER_TYPE_MAX, type.remaining ?? PER_TYPE_MAX) ||
                            total >= TOTAL_MAX
                          }
                        >
                          +
                        </StepperButton>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-neutral-border bg-neutral-dark/40 px-4 py-3 text-sm">
              <span className="text-neutral-300">
                Kiválasztott jegyek: <span className="font-semibold text-white">{total} db</span>
              </span>
              <span className="text-neutral-300">
                Összesen: <span className="font-semibold text-white">{formatHuf(totalPrice)} Ft</span>
              </span>
            </div>
          </section>

          {/* Vásárlói adatok — private buyers only */}
          <section>
            <h3 className="font-display text-xl font-bold tracking-tight text-white">
              Vásárlói adatok
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="buyer-name">
                  Név
                </label>
                <input
                  id="buyer-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="Kovács Anna"
                  className={fieldClass(nameInvalid)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="buyer-email">
                  E-mail-cím
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={200}
                  autoComplete="email"
                  placeholder="nev@pelda.hu"
                  className={fieldClass(emailInvalid)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="buyer-phone">
                  Telefonszám (nem kötelező)
                </label>
                <input
                  id="buyer-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={30}
                  autoComplete="tel"
                  placeholder="+36 20 123 4567"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="buyer-postal">
                  Irányítószám
                </label>
                <input
                  id="buyer-postal"
                  type="text"
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  maxLength={10}
                  autoComplete="postal-code"
                  placeholder="1133"
                  className={fieldClass(postalInvalid)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="buyer-city">
                  Város
                </label>
                <input
                  id="buyer-city"
                  type="text"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  maxLength={60}
                  autoComplete="address-level2"
                  placeholder="Budapest"
                  className={fieldClass(cityInvalid)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="buyer-street">
                  Utca, házszám
                </label>
                <input
                  id="buyer-street"
                  type="text"
                  value={street}
                  onChange={(event) => setStreet(event.target.value)}
                  maxLength={120}
                  autoComplete="address-line1"
                  placeholder="Garam utca 23."
                  className={fieldClass(streetInvalid)}
                />
              </div>
            </div>
          </section>

          {/* Feltételek */}
          <section className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(event) => setAcceptTerms(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>
                Elfogadom a{" "}
                <Link
                  href="/jegyek/feltetelek"
                  className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
                >
                  vásárlási feltételeket
                </Link>
                .
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={invoiceByEmail}
                onChange={(event) => setInvoiceByEmail(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>Kérem a számlát e-mailben.</span>
            </label>
          </section>

          {errors && errors.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-[#ed9a91]/30 bg-[#ed9a91]/10 p-3 text-sm text-[#ed9a91]"
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

          <div>
            <button
              type="submit"
              className={`inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 sm:w-auto ${
                submitting ? "opacity-70" : ""
              }`}
            >
              {submitting ? "Fizetés indítása…" : "Tovább a fizetéshez"}
            </button>
            <p className="mt-2 text-xs text-neutral-500">
              A fizetés a Stripe biztonságos oldalán zajlik. A jegyek a fizetés után
              e-mailben érkeznek.
            </p>
          </div>
        </form>
      )}

      {/* --------------------------------------------------------------- */}
      {/* Ingyenes jegy — the free request (card 11): no payment step, no   */}
      {/* card fields, a single „Jegy igénylése” button per free type       */}
      {/* --------------------------------------------------------------- */}
      {freeTypes.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Enter submits the (only) free type's request; with more than
            // one free type the buttons are explicit, Enter does nothing.
            if (freeTypes.length === 1) requestFreeTickets(freeTypes[0]);
          }}
          noValidate
          className="flex flex-col gap-6"
        >
          <section>
            <h3 className="font-display text-xl font-bold tracking-tight text-white">
              Ingyenes jegy
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              INGYENES JEGY IGÉNYLÉSE E-MAILLEL, FIZETÉS NÉLKÜL. IGÉNYLÉSÉNKÉNT
              LEGFELJEBB 2 JEGY, E-MAIL-CÍMENKÉNT KONCERTENKÉNT LEGFELJEBB 2.
            </p>
            <div className="mt-3 space-y-3">
              {freeTypes.map((type) => {
                const soldOut = type.remaining === 0;
                const quantity = freeQuantities[type.id] ?? 1;
                const cap = Math.min(FREE_PER_TYPE_MAX, type.remaining ?? FREE_PER_TYPE_MAX);
                return (
                  <div
                    key={type.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{type.name}</p>
                      <p className="mt-1 text-sm text-neutral-300">
                        Ingyenes
                        {type.remaining !== null && (
                          <span className="text-neutral-500">
                            {" · "}
                            {soldOut ? "Elfogyott" : `Még ${type.remaining} db`}
                          </span>
                        )}
                      </p>
                    </div>
                    {soldOut ? (
                      <span className="shrink-0 rounded-full bg-neutral-border/60 px-3 py-1.5 text-xs font-semibold text-neutral-300">
                        Elfogyott
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="flex items-center gap-2">
                          <StepperButton
                            onClick={() => freeStep(type, -1)}
                            label={`Kevesebb: ${type.name}`}
                            dim={quantity <= 1}
                          >
                            −
                          </StepperButton>
                          <span className="w-6 text-center text-base font-semibold text-white tabular-nums">
                            {quantity}
                          </span>
                          <StepperButton
                            onClick={() => freeStep(type, 1)}
                            label={`Több: ${type.name}`}
                            dim={quantity >= cap}
                          >
                            +
                          </StepperButton>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestFreeTickets(type)}
                          className={`inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
                            freeSubmitting !== null ? "opacity-70" : ""
                          }`}
                        >
                          {freeSubmitting === type.id ? "Igénylés…" : "Jegy igénylése"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Igénylői adatok — név és e-mail, ennyi kell a jegy kiállításához */}
          <section>
            <h3 className="font-display text-xl font-bold tracking-tight text-white">
              Igénylői adatok
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="free-name">
                  Név
                </label>
                <input
                  id="free-name"
                  type="text"
                  value={freeName}
                  onChange={(event) => setFreeName(event.target.value)}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="Kovács Anna"
                  className={freeFieldClass(freeNameInvalid)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="free-email">
                  E-mail-cím
                </label>
                <input
                  id="free-email"
                  type="email"
                  value={freeEmail}
                  onChange={(event) => setFreeEmail(event.target.value)}
                  maxLength={200}
                  autoComplete="email"
                  placeholder="nev@pelda.hu"
                  className={freeFieldClass(freeEmailInvalid)}
                />
              </div>
            </div>
          </section>

          <section>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={freeAcceptTerms}
                onChange={(event) => setFreeAcceptTerms(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>
                Elfogadom a{" "}
                <Link
                  href="/jegyek/feltetelek"
                  className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
                >
                  vásárlási feltételeket
                </Link>
                .
              </span>
            </label>
          </section>

          {freeErrors && freeErrors.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-[#ed9a91]/30 bg-[#ed9a91]/10 p-3 text-sm text-[#ed9a91]"
            >
              {freeErrors.length === 1 ? (
                <p>{freeErrors[0]}</p>
              ) : (
                <ul className="space-y-1">
                  {freeErrors.map((message) => (
                    <li key={message}>• {message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Az ingyenes jegy azonnal kiállításra kerül, és a megadott e-mail-címre
            érkezik a QR-kóddal együtt. Ingyenes jegyről számla nem készül.
          </p>
        </form>
      )}
    </div>
  );
}
