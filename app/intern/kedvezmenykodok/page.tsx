import BottomNav from "@/components/bottom-nav";
import InternGate from "@/components/intern-gate";
import DiscountCodesPanel from "@/components/koncertek/DiscountCodesPanel";
import type { ApiDiscountCode } from "@/components/koncertek/types";
import { fetchInternApi, hasInternCookie } from "@/lib/intern-ssr";

export const dynamic = "force-dynamic";

/**
 * /intern/kedvezmenykodok — the kedvezménykódok global list (card 12): every
 * code with used/max and the on/off switch, plus the create form (a code
 * created here applies to minden koncertre; a concert-scoped code is created
 * on the concert's own page). Cookie-gated like every intern page.
 */
export default async function KedvezmenykodokPage() {
  if (!(await hasInternCookie())) {
    return <InternGate />;
  }

  const discounts = await fetchInternApi<{ codes: ApiDiscountCode[] }>("/api/intern/kedvezmenykodok");

  return (
    <div className="flex min-h-dvh flex-col bg-background-dark">
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
        <div className="mb-2">
          <a
            href="/intern/koncertek"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Vissza a koncertekhez
          </a>
        </div>
        <h1 className="mb-4 font-display text-xl font-bold text-neutral-100">Kedvezménykódok</h1>
        <DiscountCodesPanel initialCodes={discounts?.codes ?? null} />
      </main>
      <BottomNav active="none" />
    </div>
  );
}
