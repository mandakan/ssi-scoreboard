import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Crosshair, Github } from "lucide-react";
import { Providers } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";
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
          {children}
          <footer className="w-full flex flex-col items-center gap-2 p-4 text-xs text-muted-foreground border-t border-border mt-auto">
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <a
                href="https://shootnscoreit.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="Shoot'n Score It (opens in new tab)"
              >
                <Crosshair className="w-4 h-4" aria-hidden="true" />
              </a>
              <a
                href="https://github.com/mandakan/ssi-scoreboard"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="Source code on GitHub (opens in new tab)"
              >
                <Github className="w-4 h-4" aria-hidden="true" />
              </a>
              <Link
                href="/legal"
                className="hover:text-foreground transition-colors"
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
