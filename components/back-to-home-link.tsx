"use client";

import { useRouter } from "next/navigation";
import { IconArrowForward } from "@/components/icons";

type BackToHomeLinkProps = {
  className?: string;
};

export default function BackToHomeLink({ className }: BackToHomeLinkProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push("/");
      }}
    >
      <IconArrowForward className="size-3.5 rotate-180" />
      Vissza a főoldalra
    </button>
  );
}
