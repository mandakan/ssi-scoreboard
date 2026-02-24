import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Coffee, Crosshair, Github } from "lucide-react";
import { Providers } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { UpdateBanner } from "@/components/update-banner";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers>
          <UpdateBanner />
          {children}
          <footer className="w-full flex flex-col items-center gap-2 p-4 text-xs text-muted-foreground border-t border-border mt-auto">
            {/* Buy me a coffee button – visible on sm+ screens */}
            <a
              href="https://www.buymeacoffee.com/thias"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FFDD00] text-black font-medium text-sm hover:opacity-90 transition-opacity"
              aria-label="Buy me a coffee on Buy Me a Coffee (opens in new tab)"
            >
              <Coffee className="w-4 h-4" aria-hidden="true" />
              Buy me a coffee
            </a>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <a
                href="https://shootnscoreit.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center hover:text-foreground transition-colors"
                aria-label="Shoot'n Score It (opens in new tab)"
              >
                <Crosshair className="w-4 h-4" aria-hidden="true" />
              </a>
              <a
                href="https://github.com/mandakan/ssi-scoreboard"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center hover:text-foreground transition-colors"
                aria-label="Source code on GitHub (opens in new tab)"
              >
                <Github className="w-4 h-4" aria-hidden="true" />
              </a>
              {/* Coffee icon link – mobile only (hidden on sm+) */}
              <a
                href="https://www.buymeacoffee.com/thias"
                target="_blank"
                rel="noopener noreferrer"
                className="sm:hidden inline-flex items-center hover:text-foreground transition-colors"
                aria-label="Buy me a coffee on Buy Me a Coffee (opens in new tab)"
              >
                <Coffee className="w-4 h-4" aria-hidden="true" />
              </a>
              <Link
                href="/about"
                className="inline-flex items-center hover:text-foreground transition-colors"
              >
                About
              </Link>
              <Link
                href="/legal"
                className="inline-flex items-center hover:text-foreground transition-colors"
              >
                Terms &amp; Privacy
              </Link>
            </div>
            <p className="text-center max-w-sm">
              Match data is fetched from Shoot&apos;n Score It and displayed via
              this app. SSI is not responsible for the privacy, security, or
              integrity of data shown here.
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
