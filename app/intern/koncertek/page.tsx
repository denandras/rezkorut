import InternGate from "@/components/intern-gate";
import KoncertekScreen from "@/components/koncertek/KoncertekScreen";
import type { ApiConcert, TacitoStatus } from "@/components/koncertek/types";
import { fetchInternApi, hasInternCookie } from "@/lib/intern-ssr";

export const dynamic = "force-dynamic";

/**
 * /intern/koncertek — the „Koncertek” dashboard (card 06).
 *
 * Cookie-gated like the other intern pages, but the authed view is
 * server-rendered: the page fetches the card 02 intern APIs with the
 * incoming cookie (list + TACITo health) and hands the payloads to the
 * client dashboard, which re-reads the same endpoints after every mutation.
 * Without the cookie the page renders the same password gate as /intern.
 */
export default async function KoncertekPage() {
  if (!(await hasInternCookie())) {
    return <InternGate />;
  }

  const [list, status] = await Promise.all([
    fetchInternApi<{ concerts: ApiConcert[] }>("/api/intern/koncertek"),
    fetchInternApi<TacitoStatus>("/api/intern/tacito/status"),
  ]);

  return (
    <KoncertekScreen
      initialConcerts={list?.concerts ?? null}
      initialStatus={status}
    />
  );
}
