import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import SuccessRefresher from "@/components/tickets/SuccessRefresher";
import { verifyOrderToken } from "@/lib/order-token";
import { getOrderByIdForSuccess, getOrderBySessionId } from "@/lib/tickets-public";

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
  // Free (0 Ft) orders (card 11) have no Stripe session — the free endpoint
  // returns a SIGNED confirmation token naming the order, and only a token
  // that verifies here unlocks the id-based lookup. A bare order id out of
  // a URL is never accepted (same rule as the paid flow's session id).
  const orderToken =
    typeof query.order === "string" && query.order.trim().length > 0
      ? query.order.trim()
      : null;

  const result = sessionId
    ? await getOrderBySessionId(sessionId)
    : orderToken
      ? await getOrderByIdForSuccess(verifyOrderToken(orderToken) ?? "")
      : null;

  const fulfilled = result !== null && result.tickets.length > 0;
  const free = result !== null && result.order.amount_huf === 0;

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
                {sessionId || orderToken
                  ? "Nem találtuk a rendelést ezzel az azonosítóval. Ha a vásárlást vagy a jegyigénylést elvégezte, a jegyek a megerősítő e-mailben vannak."
                  : "A visszaigazoló azonosító hiányzik. Ha a vásárlást vagy a jegyigénylést elvégezte, a jegyek a megerősítő e-mailben vannak."}
              </p>
            </section>
          ) : fulfilled ? (
            <section>
              <h2 className="font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                {free ? "Köszönjük az igénylést!" : "Köszönjük a vásárlást!"}
              </h2>
              {result.order.buyer_name && (
                <p className="mt-4 text-sm text-neutral-300">
                  Kedves {result.order.buyer_name}!
                </p>
              )}
              <p className="mt-2 text-sm text-neutral-300">
                A jegyei elkészültek. A jegyek és a visszaigazolás a megadott
                e-mail-címre is elérkeztek
                {free ? ". Ingyenes jegyről számla nem készül." : "; a számla külön e-mailben következik."}
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
                        {ticket.price_huf === 0
                          ? "Ingyenes"
                          : `${formatHuf(ticket.price_huf)} Ft`}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold tracking-widest text-primary">
                      {ticket.code}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs text-neutral-500">
                {free
                  ? "Ingyenes igénylés – fizetendő összeg 0 forint. A"
                  : `Fizetendő összeg: ${formatHuf(result.order.amount_huf)} Ft. A`}
                {" "}
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
