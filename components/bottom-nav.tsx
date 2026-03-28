import Link from "next/link";
import { IconHome, IconCalendar, IconCamera, IconUsers, IconMusicNote } from "@/components/icons";

type NavItem = "home" | "esemenyek" | "media" | "rolunk" | "cv" | "none";

type BottomNavProps = {
  active: NavItem;
};

const itemBase = "flex h-full flex-col items-center justify-center gap-0.5 transition-colors";

export default function BottomNav({ active }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-border bg-neutral-dark/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="mx-auto grid h-16 w-full max-w-2xl grid-cols-5">
        <Link
          href="/cv"
          className={`${itemBase} ${
            active === "cv" ? "text-primary" : "text-neutral-400 hover:text-primary"
          }`}
        >
          <IconMusicNote className="size-5" />
          <span className="text-[10px] leading-none">CV</span>
        </Link>

        <Link
          href="/esemenyek"
          className={`${itemBase} ${
            active === "esemenyek" ? "text-primary" : "text-neutral-400 hover:text-primary"
          }`}
        >
          <IconCalendar className="size-5" />
          <span className="text-[10px] leading-none">Események</span>
        </Link>

        <Link
          href="/"
          className={`${itemBase} ${
            active === "home" ? "text-primary" : "text-neutral-400 hover:text-primary"
          }`}
        >
          <IconHome className="size-5" />
          <span className="text-[10px] leading-none">Főoldal</span>
        </Link>

        <Link
          href="/media"
          className={`${itemBase} ${
            active === "media" ? "text-primary" : "text-neutral-400 hover:text-primary"
          }`}
        >
          <IconCamera className="size-5" />
          <span className="text-[10px] leading-none">Média</span>
        </Link>

        <Link
          href="/rolunk"
          className={`${itemBase} ${
            active === "rolunk" ? "text-primary" : "text-neutral-400 hover:text-primary"
          }`}
        >
          <IconUsers className="size-5" />
          <span className="text-[10px] leading-none">Rólunk</span>
        </Link>
      </div>
    </nav>
  );
}
