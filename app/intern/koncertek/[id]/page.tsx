import InternGate from "@/components/intern-gate";
import ConcertDetailScreen from "@/components/koncertek/ConcertDetailScreen";
import type { ApiConcert, ApiOrder, TacitoStatus } from "@/components/koncertek/types";
import { fetchInternApi, hasInternCookie } from "@/lib/intern-ssr";

export const dynamic = "force-dynamic";

/**
 * /intern/koncertek/[id] — concert detail: ticket type editor, publish/close,
 * sales summary, orders with the owner's refund path, and the TACITo tile.
 * Server-rendered with the card 02 intern APIs; the client screen refreshes
 * the same endpoints after every mutation.
 */
export default async function ConcertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await hasInternCookie())) {
    return <InternGate />;
  }

  const [list, orders, status] = await Promise.all([
    fetchInternApi<{ concerts: ApiConcert[] }>("/api/intern/koncertek"),
    fetchInternApi<{ orders: ApiOrder[] }>(`/api/intern/koncertek/${encodeURIComponent(id)}/orders`),
    fetchInternApi<TacitoStatus>("/api/intern/tacito/status"),
  ]);

  const concert = list?.concerts.find((entry) => entry.id === id) ?? null;

  return (
    <ConcertDetailScreen
      concertId={id}
      initialConcert={concert}
      initialOrders={orders?.orders ?? null}
      initialStatus={status}
    />
  );
}
