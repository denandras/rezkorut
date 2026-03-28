import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "Rólunk – Réz körút",
  description: "A Réz körút rézfúvós szeptett bemutatása és tagjai.",
};

const members = [
  { name: "Nagy Sándor", instrument: "trombita" },
  { name: "Huszti Boldizsár", instrument: "trombita" },
  { name: "Baczkó Vince", instrument: "trombita" },
  { name: "Faragó István", instrument: "kürt" },
  { name: "Dénes András", instrument: "harsona" },
  { name: "Gulyás Buda", instrument: "harsona" },
  { name: "Vida Mátyás", instrument: "tuba" },
];

export default function RolunkPage() {
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
          <h1 className="font-display text-4xl font-bold tracking-tight">Rólunk</h1>
        </div>

        {/* Bio */}
        <section className="px-6 pb-10 md:px-12">
          <div className="max-w-2xl space-y-4 text-neutral-200 leading-relaxed">
            <p>
              A Réz körút 2022-ben alakult a Liszt Ferenc Zeneművészeti Egyetem rézfúvós
              szakának hallgatóiból. Zenénk a rézfúvós hangszerek varázslatos színezetén keresztül
              enged betekintést a kamarazene gazdag világába.
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
              élmény áll a középpontban. Csatlakozzatok hozzánk, hogy együtt fedezzük fel
              a hangzásunkban rejlő lehetőségeket!
            </p>
          </div>
        </section>

        {/* Members */}
        <section className="px-6 pb-10 md:px-12">
          <h2 className="font-display mb-5 text-xl font-bold tracking-tight">Tagjaink</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <div
                key={member.name}
                className="rounded-xl border border-neutral-border bg-neutral-dark/40 px-5 py-4"
              >
                <p className="mb-0.5 text-xs font-bold tracking-widest text-primary uppercase">
                  {member.instrument}
                </p>
                <p className="font-display text-base font-semibold">{member.name}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section className="px-6 pb-4 md:px-12">
          <h2 className="font-display mb-4 text-xl font-bold tracking-tight">Kapcsolat</h2>
          <div className="space-y-2 text-sm text-neutral-300">
            <p>
              <a
                href="mailto:mail@rezkorut.hu"
                className="text-primary transition-opacity hover:opacity-80"
              >
                mail@rezkorut.hu
              </a>
            </p>
            <p>+36 30 232 8848</p>
            <div className="flex gap-4 pt-1">
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
          </div>
        </section>
      </main>

      <BottomNav active="rolunk" />
    </div>
  );
}
