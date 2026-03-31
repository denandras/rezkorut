import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Rólunk – Réz körút",
  description: "A Réz körút rézfúvós szeptett bemutatása és tagjai.",
  openGraph: {
    title: "Rólunk – Réz körút",
    description: "A Réz körút rézfúvós szeptett bemutatása és tagjai.",
    url: "https://rezkorut.hu/rolunk",
    images: [{ url: "/rolunk-photo.jpg", width: 3872, height: 2581, alt: "Réz körút csapatfotó" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rólunk – Réz körút",
    description: "A Réz körút rézfúvós szeptett bemutatása és tagjai.",
    images: ["/rolunk-photo.jpg"],
  },
};

const members = [
  { name: "Nagy Sándor", instrument: "trombita" },
  { name: "Huszti Boldizsár", instrument: "trombita" },
  { name: "Baczkó Vince", instrument: "trombita" },
  { name: "Szilágyi Dusán", instrument: "trombita" },
  { name: "Faragó István", instrument: "kürt" },
  { name: "Dénes András", instrument: "harsona" },
  { name: "Gulyás Buda", instrument: "harsona" },
  { name: "Vida Mátyás", instrument: "tuba" },
];

export default function RolunkPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">Rólunk</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 pb-24">
        <div className="w-full px-6 py-8 md:px-8">
          <section className="pt-8">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="group relative">
                <div className="absolute -inset-2 rounded-full bg-primary/25 blur-md transition duration-1000 group-hover:duration-200" />
                <div className="relative rounded-full border-2 border-primary/60 bg-charcoal p-1.5 ring-4 ring-primary/20">
                  <Image
                    src="/rolunk-photo.jpg"
                    alt="Réz körút profilkép"
                    width={192}
                    height={192}
                    className="h-[190px] w-[190px] rounded-full object-cover shadow-2xl"
                    priority
                  />
                </div>
              </div>
            </div>

            <div className="relative grid gap-6 py-2 md:grid-cols-12 md:gap-8">
              <h2 className="pointer-events-none absolute top-2 left-1 z-0 hidden max-w-[92%] font-display text-6xl leading-[0.85] font-bold tracking-tight text-white/60 uppercase md:block lg:text-7xl">
                Rólunk
              </h2>
              <div className="md:col-span-4">
                <h2 className="font-display text-4xl leading-[0.88] font-bold tracking-tight text-white uppercase md:hidden">
                  Rólunk
                </h2>
              </div>
              <div className="relative md:col-span-8">
                <div className="relative z-10 space-y-4 text-base leading-relaxed text-neutral-200 md:pt-10 md:text-lg">
                  <p>
                    A Réz körút 2022-ben alakult a Liszt Ferenc Zeneművészeti Egyetem rézfúvós
                    szakának hallgatóiból. Zenénk a rézfúvós hangszerek varázslatos színezetén
                    keresztül enged betekintést a kamarazene gazdag világába.
                  </p>
                  <p>
                    Progresszív szemléletünk nem csak a múlt nagy műveinek átiratait öleli fel,
                    hanem kortárs szerzeményekkel is kísérletezünk, hogy mindig friss és izgalmas
                    előadást hozzunk létre. Új koncepciónkkal azt a célt tűztük ki, hogy közülünk
                    2024-ben éppen október 28-án elhunyt Szabó Benedek tubásunk és zeneszerzőnk
                    örökségét továbbvigyük, miközben új utakat járunk be a rézfúvós zenében.
                  </p>
                  <p>
                    Következő projektjeinkben is a sokszínűség, a kísérletezés és a komplex zenei
                    élmény áll a középpontban. Csatlakozzatok hozzánk, hogy együtt fedezzük fel a
                    hangzásunkban rejlő lehetőségeket.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 border-t border-neutral-border/80">
            <div className="relative grid gap-6 py-10 md:grid-cols-12 md:gap-8">
              <h2 className="pointer-events-none absolute top-11 right-1 z-0 hidden max-w-[92%] text-right font-display text-6xl leading-[0.85] font-bold tracking-tight text-white/60 uppercase md:block lg:text-7xl">
                Tagok
              </h2>
              <div className="md:order-2 md:col-span-4 md:text-right">
                <h2 className="font-display text-4xl leading-[0.88] font-bold tracking-tight text-white uppercase md:hidden">
                  Tagok
                </h2>
              </div>
              <div className="relative md:order-1 md:col-span-8">
                <div className="relative z-10 grid grid-cols-1 gap-3 md:pt-10 sm:grid-cols-2 lg:grid-cols-3">
                  {members.map((member) => (
                    <article
                      key={member.name}
                      className="interactive-surface rounded-xl border border-neutral-border bg-neutral-dark/40 px-5 py-4 transition-all hover:border-primary/30 hover:bg-neutral-dark"
                      data-proximity
                      data-proximity-strength="2.1"
                    >
                      <p className="mb-0.5 text-xs font-bold tracking-widest text-primary uppercase">
                        {member.instrument}
                      </p>
                      <p className="font-display text-base font-semibold">{member.name}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-neutral-border/80 pt-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display mb-4 text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
                Kapcsolat
              </h2>
              <div className="space-y-2 text-sm text-neutral-300 md:text-base">
                <p>
                  <a
                    href="mailto:rezkorut@gmail.com"
                    className="text-primary transition-opacity hover:opacity-80"
                  >
                    rezkorut@gmail.com
                  </a>
                </p>
                <p>+36 30 232 8848</p>
                <div className="flex flex-wrap items-center justify-center gap-4 pt-1">
                  <a
                    href="https://instagram.com/rezkorut"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-opacity hover:opacity-80 hover:text-primary"
                  >
                    Instagram
                  </a>
                  <a
                    href="https://youtube.com/@rezkorut"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-opacity hover:opacity-80 hover:text-primary"
                  >
                    YouTube
                  </a>
                  <a
                    href="https://facebook.com/people/R%C3%A9z-k%C3%B6r%C3%BAt/61571890856498"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-opacity hover:opacity-80 hover:text-primary"
                  >
                    Facebook
                  </a>
                </div>
                <div className="pt-7">
                  <Image
                    src="/rolunk-logo.png"
                    alt="Réz körút logó"
                    width={220}
                    height={220}
                    className="mx-auto h-auto w-40 md:w-48"
                    priority
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <div className="pb-24 pt-4 text-center">
        <a href="/intern" className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
          Intern
        </a>
      </div>
      <BottomNav active="rolunk" />
    </div>
  );
}
