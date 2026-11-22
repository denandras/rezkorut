"use client";

/* Page title block (design spec §2.2). Not InternTitle — this page has its own name. */
export default function BeosztasHeader() {
  return (
    <div className="mb-5 sm:mb-6">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Réz körút</p>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h1 className="font-display text-2xl font-bold text-neutral-100 sm:text-[26px]">Próbarend</h1>
      </div>
    </div>
  );
}
