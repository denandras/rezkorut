import type { Metadata } from "next";
import { Lexend_Deca } from "next/font/google";
import ProximityEffects from "@/components/proximity-effects";
import "./globals.css";

const lexendDeca = Lexend_Deca({
  variable: "--font-lexend-deca",
  subsets: ["latin", "latin-ext"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rezkorut.hu"),
  title: "Réz körút | Rézfúvós szeptett",
  description: "Réz körút – Budapesti rézfúvós szeptett. Megállítjuk az időt.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/rolunk-logo.png",
  },
  openGraph: {
    title: "Réz körút | Rézfúvós szeptett",
    description: "Budapesti rézfúvós szeptett. Megállítjuk az időt.",
    url: "https://rezkorut.hu",
    siteName: "Réz körút",
    locale: "hu_HU",
    type: "website",
    images: [
      {
        url: "/hero.jpg",
        width: 2048,
        height: 1365,
        alt: "Réz körút – Budapesti rézfúvós szeptett",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Réz körút | Rézfúvós szeptett",
    description: "Budapesti rézfúvós szeptett. Megállítjuk az időt.",
    images: ["/hero.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu" className="dark">
      <head>
        {/* Prefetch all pages for instant navigation */}
        <link rel="prefetch" href="/" />
        <link rel="prefetch" href="/esemenyek" />
        <link rel="prefetch" href="/media" />
        <link rel="prefetch" href="/rolunk" />
        <link rel="prefetch" href="/terez-korut" />
        <link rel="prefetch" href="/madmans-treasure" />
      </head>
      <body className={lexendDeca.variable}>
        <ProximityEffects />
        {children}
      </body>
    </html>
  );
}
