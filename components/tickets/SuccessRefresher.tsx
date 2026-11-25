"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible helper for the success page's pending state: after `seconds`
 * (default 10) it asks Next to re-render the server component, so the ticket
 * codes appear as soon as the webhook has fulfilled the order — without an
 * auto-redirect, the buyer stays on the page the whole time.
 */
export default function SuccessRefresher({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), seconds * 1000);
    return () => clearTimeout(timer);
  }, [router, seconds]);
  return null;
}
