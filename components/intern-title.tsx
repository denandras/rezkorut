import Image from "next/image";

/* Intern title texts with the trumpet mark beside them - transparent
   render (megallitott-ido rig, Aedrian1 model, CC BY 4.0). The mark is
   absolutely positioned out of flow, so the title block's vertical
   rhythm is unchanged on every platform; it floats gently under
   motion-safe and stays still under prefers-reduced-motion. */
export function InternTitle() {
  return (
    <div className="relative w-fit">
      <p className="font-display mb-1 text-xs font-bold tracking-[0.2em] text-primary uppercase">
        Réz körút
      </p>
      <h1 className="font-display mb-6 text-2xl font-bold text-neutral-100">
        Intern
      </h1>
      <div
        className="absolute left-full top-1/2 ml-1.5 w-[clamp(48px,calc(100vw-282px),120px)] -translate-y-1/2"
        aria-hidden="true"
      >
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes trumpetMarkFloat {
              0%, 100% { transform: rotate(-1.2deg) translateY(0); }
              50% { transform: rotate(1.2deg) translateY(-3px); }
            }
            .trumpet-mark-float {
              animation: trumpetMarkFloat 6s ease-in-out infinite;
              transform-origin: 50% 60%;
            }
          }
        `}</style>
        <Image
          src="/trumpet-mark.png"
          alt=""
          width={640}
          height={280}
          className="trumpet-mark-float h-auto w-full"
        />
      </div>
    </div>
  );
}
