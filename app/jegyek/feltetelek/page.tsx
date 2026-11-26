import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "Vásárlási feltételek és adatkezelési tájékoztató – Réz körút",
  description:
    "A rezkorut.hu-n vásárolt koncertjegyek vásárlási feltételei és a jegyvásárláshoz kapcsolódó adatkezelési tájékoztató.",
  robots: { index: true },
};

const sectionHeading = "mt-10 font-display text-lg font-bold tracking-tight text-white";
const bodyText = "mt-3 text-sm leading-relaxed text-neutral-300";
const listClass = "mt-3 list-disc space-y-1.5 pl-5";
const listItem = "text-sm leading-relaxed text-neutral-300";
const emailLink = "text-primary underline underline-offset-2 hover:opacity-80";
const contactBox =
  "mt-4 rounded-xl border border-neutral-border bg-neutral-dark/40 p-4 text-sm leading-relaxed text-neutral-300";

export default function FeltetelekPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">
            Feltételek
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 px-6 pb-24 pt-8 md:px-8">
        <div className="w-full">
          <p className="text-xs text-neutral-500">
            Tervezet – jogi ellenőrzés alatt.
          </p>

          <h2 className="mt-6 font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
            Vásárlási feltételek
          </h2>

          <h3 className={sectionHeading}>1. A szerződés tárgya</h3>
          <p className={bodyText}>
            Jelen vásárlási feltételek (a továbbiakban: Feltételek) a Réz körút
            által szervezett koncertek jegyeinek online értékesítésére
            vonatkoznak. A jegyeket a rezkorut.hu oldalon, kizárólag bankkártyás
            fizetéssel lehet megvásárolni. Helyszíni jegyvásárlás nincs,
            kivéve, ha a szervező ettől eltérően külön tájékoztatást ad.
          </p>

          <h3 className={sectionHeading}>2. A jegy jellege</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A jegy nem névre szóló, szabad helyválasztásos: a belépés
              érkezési sorrendben történik.
            </li>
            <li className={listItem}>
              A jegy elektronikus, QR-kóddal ellátott formában, e-mailben kerül
              kiszolgálásra.
            </li>
            <li className={listItem}>
              A jegy átruházható: a koncertre a QR-kód birtokosa léphet be.
            </li>
            <li className={listItem}>
              Egy vásárlás során legfeljebb 6 jegy vásárolható.
            </li>
            <li className={listItem}>
              A jegyeket kizárólag magánszemélyek vásárolhatják meg; céges
              számla nem kérhető.
            </li>
          </ul>

          <h3 className={sectionHeading}>3. Ár és fizetés</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A jegy árát az oldalon feltüntetett, bruttó díjban kell
              megfizetni, bankkártyával, a Stripe fizetési szolgáltatón
              keresztül.
            </li>
            <li className={listItem}>
              Az árak forintban értendők. A jegy ára a teljes fizetendő
              összeg, azon felül semmilyen kezelési vagy egyéb díjat nem
              számítunk fel.
            </li>
            <li className={listItem}>
              Az eladó alanyi adómentes, ezért a jegy ára áfát nem tartalmaz.
            </li>
          </ul>

          <h3 className={sectionHeading}>4. A szerződés létrejötte</h3>
          <p className={bodyText}>
            A szerződés a vásárló által megadott adatok alapján, a fizetés
            sikeres lezárulásával jön létre. A vásárló a fizetés megkezdése
            előtt jelölőnégyzettel fogadja el a vásárlási feltételeket, és
            hozzájárul az elektronikus számla kiállításához. A jegyek és a
            számla a megadott e-mail címre érkeznek.
          </p>

          <h3 className={sectionHeading}>5. Jegykiadás és beléptetés</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A fizetést követően a rendszer e-mailben elküldi a QR-kódos
              jegyeket és a visszaigazolást.
            </li>
            <li className={listItem}>
              A koncert helyszínén a belépés a QR-kód leolvasásával történik; a
              jegy ellenőrzése céljából a szervező a kódot leolvashatja.
            </li>
            <li className={listItem}>
              A jegy elvesztése esetén a vásárló a megadott elérhetőségen
              kérheti a jegy újraküldését.
            </li>
            <li className={listItem}>
              Sérült vagy olvashatatlan QR-kód esetén a szervező a vásárlás
              visszaigazolása alapján biztosítja a belépést.
            </li>
          </ul>

          <h3 className={sectionHeading}>6. Lemondás és visszatérítés</h3>
          <p className={bodyText}>
            Fontos tudni: a koncertjegy egy meghatározott időpontban
            teljesítendő szabadidős tevékenységre irányuló szerződés, ezért a
            vásárlót a 45/2014. (II. 26.) Korm. rendelet szerinti 14 napos
            indokolás nélküli elállási jog e szerződésre nem illeti meg.
          </p>
          <ul className={listClass}>
            <li className={listItem}>
              A megvásárolt jegyre a vásárló lemondása esetén visszatérítés nem
              jár; a jegy átruházható, ezért a meg nem tartott koncertre szóló
              jegyet másnak továbbadhatja.
            </li>
            <li className={listItem}>
              Ha a koncert elmarad, vagy időpontja lényegesen megváltozik, a
              jegy árát teljes egészében visszatérítjük, vagy – a vásárló
              választása szerint – a jegyet másik koncertre váltjuk.
            </li>
            <li className={listItem}>
              A visszatérítést ilyen esetben legkésőbb a koncert eredeti
              időpontját követő 30 napon belül utaljuk vissza a fizetéshez
              használt kártyára.
            </li>
          </ul>

          <h3 className={sectionHeading}>7. Panaszkezelés és elérhetőség</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A vásárlóval szembeni panaszokat az eladó a{" "}
              <a href="mailto:contact@andrasdenes.com" className={emailLink}>
                contact@andrasdenes.com
              </a>{" "}
              e-mail címen fogadja, és 30 napon belül írásban válaszol.
            </li>
            <li className={listItem}>
              Ha a panasz elutasításra kerül, az eladó tájékoztatja a vásárlót
              a jogorvoslati lehetőségekről.
            </li>
            <li className={listItem}>
              A fogyasztó a panaszával a fogyasztóvédelmi hatósághoz (fővárosi
              vagy megyei kormányhivatal), illetve a lakóhelye szerint illetékes
              békéltető testülethez fordulhat — Budapesten a Budapesti
              Kereskedelmi és Iparkamara mellett működő Békéltető Testülethez.
            </li>
          </ul>

          <h3 className={sectionHeading}>8. Egyéb rendelkezések</h3>
          <ul className={listClass}>
            <li className={listItem}>
              Jelen Feltételekre a magyar jog az irányadó; a Ptk. szerinti
              fogyasztói és kereskedelmi szerződésekre vonatkozó rendelkezések,
              valamint a 45/2014. (II. 26.) Korm. rendelet a távollévőkkel kötött
              szerződésekre vonatkozó fogyasztóvédelmi szabályai irányadók.
            </li>
            <li className={listItem}>
              Az eladó a Feltételekben foglalt fogyasztói jogokat nem
              korlátozza; a Feltételek és a vonatkozó jogszabályok ellentmondása
              esetén a jogszabály az irányadó.
            </li>
          </ul>

          <div className={contactBox}>
            <strong className="font-semibold text-white">Eladó:</strong>{" "}
            Dénes András egyéni vállalkozó (1133 Budapest, Garam utca 23.;
            adószám: 90416576-1-41; e-mail:{" "}
            <a href="mailto:contact@andrasdenes.com" className={emailLink}>
              contact@andrasdenes.com
            </a>
            )
          </div>

          <h2 className="mt-16 font-display text-3xl leading-[0.9] font-bold tracking-tight text-white uppercase">
            Adatkezelési tájékoztató
          </h2>

          <h3 className={sectionHeading}>Kezelt adatok</h3>
          <ul className={listClass}>
            <li className={listItem}>Név, e-mail cím, telefonszám, számlázási cím</li>
            <li className={listItem}>
              Tranzakció- és beléptetési adatok (a fizetés és a QR-kód leolvasása
              során)
            </li>
          </ul>

          <h3 className={sectionHeading}>A kezelés célja és jogalapja</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A jegykiadás, visszaigazolás és beléptetés lebonyolítása — a
              szerződés teljesítése érdekében szükséges adatkezelés.
            </li>
            <li className={listItem}>
              A számla kiállítása — jogszabályban (áfa tv., számviteli
              szabályok) előírt kötelezettség teljesítése.
            </li>
            <li className={listItem}>
              A fizetés biztonságos lebonyolítása — a szerződés teljesítése.
            </li>
          </ul>

          <h3 className={sectionHeading}>Adatfeldolgozók</h3>
          <ul className={listClass}>
            <li className={listItem}>
              Stripe (fizetési szolgáltatás) — Írország
            </li>
            <li className={listItem}>TACITo (számlázás) — Magyarország</li>
            <li className={listItem}>
              Purelymail (e-mail-küldés) — Egyesült Államok
            </li>
            <li className={listItem}>
              Supabase (adatbázis) — Egyesült Államok
            </li>
            <li className={listItem}>Vercel (tárhely) — Egyesült Államok</li>
          </ul>
          <p className={bodyText}>
            Az adatokhoz kizárólag a szervező és a fent felsorolt
            adatfeldolgozók férnek hozzá. A beléptetésnél kép- vagy biometrikus
            adat nem készül, a QR-kód leolvasása nem rögzít ilyen adatot.
          </p>

          <h3 className={sectionHeading}>Megőrzés</h3>
          <ul className={listClass}>
            <li className={listItem}>
              A számlázási adatokat a jogszabályi kötelezettség szerint 8 évig
              őrizzük meg.
            </li>
            <li className={listItem}>
              Minden egyéb vásárlási adatot a koncertet követően legfeljebb 1
              évig tárolunk, majd törlünk.
            </li>
          </ul>

          <h3 className={sectionHeading}>Érintetti jogok</h3>
          <p className={bodyText}>
            Az érintett a GDPR-ban rögzített jogaival élhet: kérheti az adataihoz
            való hozzáférést, azok helyesbítését vagy törlését, és tiltakozhat az
            adatkezelés ellen. Kérelmét a{" "}
            <a href="mailto:contact@andrasdenes.com" className={emailLink}>
              contact@andrasdenes.com
            </a>{" "}
            címen nyújthatja be; azt legfeljebb 30 napon belül elbíráljuk és
            írásban válaszolunk.
          </p>

          <h3 className={sectionHeading}>Elérhetőség</h3>
          <div className={contactBox}>
            Adatkezelő: Dénes András egyéni vállalkozó — 1133 Budapest, Garam
            utca 23.; e-mail:{" "}
            <a href="mailto:contact@andrasdenes.com" className={emailLink}>
              contact@andrasdenes.com
            </a>
          </div>
        </div>
      </main>

      <BottomNav active="esemenyek" />
    </div>
  );
}
