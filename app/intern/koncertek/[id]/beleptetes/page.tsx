import BottomNav from "@/components/bottom-nav";
import InternGate from "@/components/intern-gate";
import CheckinPanel from "@/components/koncertek/CheckinPanel";
import type { ApiConcert, ApiOrder } from "@/components/koncertek/types";
import { fetchInternApi, hasInternCookie } from "@/lib/intern-ssr";

export const dynamic = "force-dynamic";

/**
 * /intern/koncertek/[id]/beleptetes — the door check-in screen. The header and
 * the used / total sold counter are server-rendered from the intern APIs
 * (orders of the concert); every scan updates the counter from the
 * /api/intern/checkin response itself.
 */
export default async function BeleptetesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await hasInternCookie())) {
    return <InternGate />;
  }

  const [list, ordersRes] = await Promise.all([
    fetchInternApi<{ concerts: ApiConcert[] }>("/api/intern/koncertek"),
    fetchInternApi<{ orders: ApiOrder[] }>(`/api/intern/koncertek/${encodeURIComponent(id)}/orders`),
  ]);

  const concert = list?.concerts.find((entry) => entry.id === id) ?? null;
  const tickets = (ordersRes?.orders ?? []).flatMap((order) => order.tickets);
  const initialCounts = {
    used: tickets.filter((ticket) => ticket.status === "used").length,
    sold: tickets.filter((ticket) => ticket.status !== "void").length,
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background-dark">
      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
        <div className="mb-2">
          <a
            href={`/intern/koncertek/${encodeURIComponent(id)}`}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza a koncerthez
          </a>
        </div>

        {concert ? (
          <>
            <h1 className="font-display text-xl font-bold text-neutral-100">Beléptetés</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-primary">
              {concert.date}
              {concert.time ? ` – ${concert.time}` : ""}
            </p>
            <p className="mt-0.5 text-sm text-neutral-300">{concert.title}</p>
            <p className="text-xs text-neutral-500">
              {[concert.location, concert.venue].filter(Boolean).join(", ")}
            </p>
          </>
        ) : (
          <h1 className="font-display text-xl font-bold text-neutral-100">Beléptetés</h1>
        )}

        <div className="mt-4">
          <CheckinPanel concertId={id} initialCounts={initialCounts} />
        </div>
      </main>
      <BottomNav active="none" />
    </div>
  );
}
