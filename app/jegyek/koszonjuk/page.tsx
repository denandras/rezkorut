import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import SuccessRefresher from "@/components/tickets/SuccessRefresher";
import { getOrderBySessionId } from "@/lib/tickets-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Köszönjük a vásárlást – Réz körút",
  description: "Jegyei és a visszaigazolás a megadott e-mail-címre érkeznek.",
};

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** Deterministic HU price formatting (same helper as the buy form). */
function formatHuf(amount: number): string {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

export default async function KoszonjukPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const sessionId =
    typeof query.session_id === "string" && query.session_id.trim().length > 0
      ? query.session_id.trim()
      : null;

  // Lookup by the buyer's own Stripe session id only — never by order id or
  // buyer e-mail. The page shows the buyer's own name and the ticket codes,
  // nothing else.
  const result = sessionId ? await getOrderBySessionId(sessionId) : null;

  const fulfilled = result !== null && result.tickets.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">
            Jegyvásárlás
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 px-6 pb-24 pt-8 md:px-8">
        <div className="w-full">
          {result === null ? (
            <section>
              <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                Köszönjük!
              </h2>
              <p className="mt-4 text-sm text-neutral-300">
                {sessionId
                  ? "Nem találtuk a fizetést ezzel az azonosítóval. Ha a vásárlást elvégezte, a jegyek a megerősítő e-mailben vannak."
                  : "A fizetési azonosító hiányzik. Ha a vásárlást elvégezte, a jegyek a megerősítő e-mailben vannak."}
              </p>
            </section>
          ) : fulfilled ? (
            <section>
              <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                Köszönjük a vásárlást!
              </h2>
              {result.order.buyer_name && (
                <p className="mt-4 text-sm text-neutral-300">
                  Kedves {result.order.buyer_name}!
                </p>
              )}
              <p className="mt-2 text-sm text-neutral-300">
                A jegyei elkészültek. A jegyek és a visszaigazolás a megadott
                e-mail-címre is elérkeztek; a számla külön e-mailben következik.
              </p>
              <ul className="mt-6 space-y-3">
                {result.tickets.map((ticket) => (
                  <li
                    key={ticket.code}
                    className="flex items-center justify-between gap-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {ticket.type ?? "Jegy"}
                      </p>
                      <p className="mt-1 text-sm text-neutral-400">
                        {formatHuf(ticket.price_huf)} Ft
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold tracking-widest text-primary">
                      {ticket.code}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs text-neutral-500">
                Fizetendő összeg: {formatHuf(result.order.amount_huf)} Ft. A
                jegyek a koncertre belépéskor a kód alapján azonosítódnak.
              </p>
            </section>
          ) : (
            <section>
              <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                Köszönjük a vásárlást!
              </h2>
              <p className="mt-4 text-sm text-neutral-300">
                A fizetését megkaptuk, a jegyek elkészítése folyamatban van. A
                jegyek e-mailben érkeznek – ez az oldal 10 másodperc múlva
                magától frissül, a jegykódok itt is megjelennek.
              </p>
              <SuccessRefresher seconds={10} />
            </section>
          )}
        </div>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
