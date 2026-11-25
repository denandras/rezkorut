import type { Metadata } from "next";

import { formatTimestampHu, isoToHuDate } from "@/components/koncertek/types";
import BeleptetesButton from "@/components/tickets/BeleptetesButton";
import { hasInternCookie } from "@/lib/intern-ssr";
import { getTicketByCode } from "@/lib/tickets-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jegy – Réz körút",
  description: "Réz körút koncertjegy.",
};

type PageProps = {
  params: Promise<{ code: string }>;
};

/** The ticket's state in one word, colored like the check-in panel's result. */
function stateWord(status: "valid" | "used" | "void"): { word: string; className: string } {
  switch (status) {
    case "valid":
      return { word: "Érvényes", className: "text-[#86e3a0]" };
    case "used":
      return { word: "Beléptetve", className: "text-[#e6be5f]" };
    case "void":
      return { word: "Visszaváltott", className: "text-[#ed9a91]" };
  }
}

function Wordmark() {
  return (
    <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-primary">
      Réz körút
    </p>
  );
}

/**
 * /j/[code] — the QR target of every ticket (card 08). Minimal chrome, no
 * bottom nav: the wordmark, the ticket's state in one word, the concert
 * facts, the type, the code — and nothing about the buyer (the lookup
 * projection in lib/tickets-public never selects buyer data).
 *
 * Door person path: with the intern cookie, a `valid` ticket and a concert
 * that is not closed, a primary „Beléptetés” button POSTs the existing
 * intern check-in route and flips to „Érvényes jegy – beléptetve”. Without
 * the cookie there is no button — just the facts and a line that the ticket
 * is checked at the door. An unknown code renders the same calm page with
 * HTTP 200, with no detail about the code's shape.
 */
export default async function JegyPage({ params }: PageProps) {
  const { code } = await params;
  const [data, intern] = await Promise.all([getTicketByCode(code), hasInternCookie()]);

  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col bg-background-dark text-neutral-100">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
          <Wordmark />
          <h1 className="mt-6 font-display text-2xl font-bold tracking-tight text-neutral-100">
            Ilyen kóddal nem találunk jegyet.
          </h1>
          <p className="mt-3 text-sm text-neutral-400">
            Kérdés esetén írjon nekünk: contact@andrasdenes.com
          </p>
        </main>
      </div>
    );
  }

  const { concert, ticket } = data;
  const state = stateWord(ticket.status);
  const dateHu = isoToHuDate(concert?.date ?? null);
  const when = [dateHu, concert?.time].filter(Boolean).join(", ");
  const place = [concert?.location, concert?.venue].filter(Boolean).join(", ");

  return (
    <div className="flex min-h-dvh flex-col bg-background-dark text-neutral-100">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Wordmark />
        <h1
          className={`mt-6 font-display text-3xl leading-[0.9] font-bold tracking-tight uppercase ${state.className}`}
        >
          {state.word}
        </h1>
        {ticket.status === "used" && (
          <p className="mt-2 text-sm text-neutral-300">A jegyet már beléptették.</p>
        )}
        {ticket.status === "void" && (
          <p className="mt-2 text-sm text-neutral-300">A jegyet visszaváltották.</p>
        )}

        <section className="mt-6 rounded-xl border border-neutral-border bg-neutral-dark/60 p-5">
          {concert && (
            <>
              <h2 className="font-display text-lg font-bold leading-tight text-neutral-100">
                {concert.title}
              </h2>
              {when && (
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  {when}
                </p>
              )}
              {place && <p className="mt-1 text-sm text-neutral-300">{place}</p>}
            </>
          )}
          <div className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                Jegytípus
              </span>
              <span className="text-sm font-semibold text-neutral-100">
                {ticket.type ?? "Jegy"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                Jegykód
              </span>
              <span className="font-mono text-base font-bold tracking-[0.2em] text-neutral-100">
                {ticket.code}
              </span>
            </div>
          </div>
          {ticket.used_at && (
            <p className="mt-3 text-xs text-neutral-500">
              Beléptetve: {formatTimestampHu(ticket.used_at)}
            </p>
          )}
        </section>

        <div className="mt-5">
          {intern && concert && ticket.status === "valid" && concert.status !== "closed" ? (
            <BeleptetesButton concertId={concert.concert_id} code={ticket.code} />
          ) : (
            <p className="text-xs text-neutral-500">
              A jegyet a koncertre belépéskor, a QR-kód alapján ellenőrzik.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
