import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { InstallBanner } from "@/components/install-banner";
import { UpdateBanner } from "@/components/update-banner";
import { Footer } from "@/components/footer";
import { BottomNav } from "@/components/bottom-nav";
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
  title: "SSI Scoreboard",
  description: "Live stage-by-stage IPSC competitor comparison",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SSI Scoreboard",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "SSI Scoreboard",
    description: "Live stage-by-stage IPSC competitor comparison",
    type: "website",
    siteName: "SSI Scoreboard",
    images: [{ url: "/api/og", width: 1200, height: 630, alt: "SSI Scoreboard — Live IPSC competitor comparison" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SSI Scoreboard",
    description: "Live stage-by-stage IPSC competitor comparison",
    images: [{ url: "/api/og", alt: "SSI Scoreboard — Live IPSC competitor comparison" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers nonce={nonce}>
          <InstallBanner />
          <UpdateBanner />
          {children}
          <Footer />
          <BottomNav />
          {/* Spacer so content isn't hidden behind the fixed bottom nav on mobile */}
          <div className="h-14 md:hidden" aria-hidden="true" />
        </Providers>
      </body>
    </html>
  );
}
