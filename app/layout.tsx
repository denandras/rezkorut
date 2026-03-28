import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import ProximityEffects from "@/components/proximity-effects";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rezkorut.hu"),
  title: "Réz körút | Rézfúvós szeptett",
  description: "Réz körút – Budapesti rézfúvós szeptett. Megállítjuk az időt.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Réz körút | Rézfúvós szeptett",
    description: "Budapesti rézfúvós szeptett. Megállítjuk az időt.",
    url: "https://rezkorut.hu",
    siteName: "Réz körút",
    locale: "hu_HU",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu" className="dark">
      <body className={`${inter.variable} ${outfit.variable}`}>
        <ProximityEffects />
        {children}
      </body>
    </html>
  );
}
