import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Providers } from "@/components/providers";
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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers>
          {children}
          <footer className="w-full flex justify-center gap-4 p-4 text-xs text-muted-foreground border-t border-border mt-auto">
            <span>
              Powered by{" "}
              <a
                href="https://shootnscoreit.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Shoot&apos;n Score It
              </a>
            </span>
            <span aria-hidden="true">·</span>
            <a
              href="https://github.com/mandakan/ssi-scoreboard"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              GitHub
            </a>
            <span aria-hidden="true">·</span>
            <Link
              href="/legal"
              className="hover:text-foreground underline underline-offset-4"
            >
              Terms &amp; Privacy
            </Link>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
