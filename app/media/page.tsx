import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import MediaGallery from "@/components/media-gallery";

export const metadata: Metadata = {
  title: "Média – Réz körút",
  description: "A Réz körút rézfúvós szeptett fotógalériája.",
};

export default function MediaPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <main className="flex-1 pb-24">
        <div className="px-6 pt-10 pb-8 md:px-12">
          <div className="mb-1 flex items-center gap-3">
            <div className="h-px w-8 bg-primary" />
            <span className="text-xs font-bold tracking-widest text-primary uppercase">
              Réz körút
            </span>
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Média</h1>
          <p className="mt-2 text-sm text-neutral-400">Fotók a fellépéseinkről</p>
        </div>

        <div className="px-6 md:px-12">
          <MediaGallery />
        </div>
      </main>

      <BottomNav active="media" />
    </div>
  );
}
