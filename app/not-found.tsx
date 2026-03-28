import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-6 text-center text-neutral-100">
      <div className="mb-1 flex items-center justify-center gap-3">
        <div className="h-px w-8 bg-primary" />
        <span className="text-xs font-bold tracking-widest text-primary uppercase">
          Réz körút
        </span>
        <div className="h-px w-8 bg-primary" />
      </div>
      <h1 className="font-display mt-6 text-6xl font-bold">404</h1>
      <p className="mt-3 text-neutral-400">Az oldal nem található.</p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/20"
      >
        Vissza a főoldalra
      </Link>
    </div>
  );
}
