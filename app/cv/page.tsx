import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "CV – Réz körút",
  description: "A Réz körút rézfúvós szeptett szakmai önéletrajza és referenciái.",
  openGraph: {
    title: "CV – Réz körút",
    description: "A Réz körút rézfúvós szeptett szakmai önéletrajza és referenciái.",
    url: "https://rezkorut.hu/cv",
  },
  twitter: {
    card: "summary_large_image",
    title: "CV – Réz körút",
    description: "A Réz körút rézfúvós szeptett szakmai önéletrajza és referenciái.",
  },
};

export default function CvPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">CV</h1>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center pb-24 text-center px-6">
        <p className="mt-3 text-neutral-400">Hamarosan…</p>
      </main>

      <BottomNav active="cv" />
    </div>
  );
}
