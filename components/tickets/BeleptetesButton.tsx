"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatTimestampHu, type CheckinResponse } from "@/components/koncertek/types";

/**
 * „Beléptetés” button of the /j/[code] page (card 08): the door person's
 * primary action. The server page renders it only when the intern cookie was
 * present at render time, the ticket is `valid` and the concert is not
 * closed. One POST to the existing intern check-in route; on `valid` the
 * block flips to „Érvényes jegy – beléptetve” with the door time, then
 * router.refresh() re-renders the page from the DB. Failures never show a
 * scary error — one calm line, the button stays usable.
 */
export default function BeleptetesButton({
  concertId,
  code,
}: {
  concertId: string;
  code: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ usedAt: string | null; already: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function beleptet() {
    if (pending) return;
    setPending(true);
    setNote(null);
    try {
      const res = await fetch("/api/intern/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concert_id: concertId, code }),
      });
      const data = (await res.json().catch(() => null)) as CheckinResponse | null;
      if (!res.ok || !data) throw new Error("request failed");
      if (data.result === "valid" || data.result === "used") {
        setDone({ usedAt: data.ticket?.used_at ?? null, already: data.result === "used" });
        router.refresh();
        return;
      }
      if (data.result === "void") {
        setNote("A jegy visszaváltott, beléptetésre nem használható.");
      } else if (data.result === "wrong_concert") {
        setNote("A kód nem ehhez a koncerthez tartozik.");
      } else {
        setNote("Ismeretlen kód.");
      }
      setPending(false);
    } catch {
      setNote("Nem sikerült a beléptetés. Kérem, próbálja újra.");
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[#86e3a0]/50 bg-[#86e3a0]/10 p-5">
        <p className="text-lg font-bold text-[#86e3a0]">
          {done.already ? "A jegyet már beléptették" : "Érvényes jegy – beléptetve"}
        </p>
        {done.usedAt && (
          <p className="mt-1 text-sm text-[#86e3a0]/90">{formatTimestampHu(done.usedAt)}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={beleptet}
        className={`inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90 ${
          pending ? "opacity-70" : ""
        }`}
      >
        {pending ? "Beléptetés…" : "Beléptetés"}
      </button>
      {note && <p className="mt-2 text-xs text-[#ed9a91]">{note}</p>}
    </div>
  );
}
