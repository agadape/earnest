import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SITE_URL } from "@/lib/server/site";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: "Tanda Jadi: pre-orders that pay you back",
    template: "%s · Tanda Jadi",
  },
  description:
    "Put down a deposit before it's built. If too few people join, you get it back plus a bonus.",
  // Title, description and picture are filled in from the page's own and from the
  // `opengraph-image` next to it. A page that sets `openGraph` replaces all of this.
  openGraph: { siteName: "Tanda Jadi", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f8f7f4",
};

// Only what every page shares. The header, footer and wallet live in `(site)/layout.tsx`, so
// the card under `(embed)` can do without them.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
