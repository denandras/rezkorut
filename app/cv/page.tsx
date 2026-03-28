import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "CV – Réz körút",
};

export default function CvPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <main className="flex flex-1 flex-col items-center justify-center pb-24 text-center px-6">
        <div className="mb-1 flex items-center justify-center gap-3">
          <div className="h-px w-8 bg-primary" />
          <span className="text-xs font-bold tracking-widest text-primary uppercase">
            Réz körút
          </span>
          <div className="h-px w-8 bg-primary" />
        </div>
        <h1 className="font-display mt-4 text-4xl font-bold tracking-tight">CV</h1>
        <p className="mt-3 text-neutral-400">Hamarosan…</p>
      </main>

      <BottomNav active="cv" />
    </div>
  );
}
