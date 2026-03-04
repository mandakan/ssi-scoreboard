import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchOgShooterData } from "@/lib/og-data";
import { ShooterDashboardClient } from "./shooter-dashboard-client";

interface Props {
  params: Promise<{ shooterId: string }>;
  searchParams: Promise<{ from?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shooterId } = await params;
  const id = parseInt(shooterId, 10);

  const shooter = !isNaN(id) && id > 0 ? await fetchOgShooterData(id) : null;

  const name = shooter?.name ?? `Shooter #${shooterId}`;
  const title = `${name} — SSI Scoreboard`;

  const descParts = [
    shooter?.division,
    shooter?.club,
    shooter ? `${String(shooter.matchCount)} matches` : null,
  ].filter(Boolean);
  const description =
    descParts.length > 0
      ? descParts.join(" \u00b7 ")
      : "Personal match history and performance stats across IPSC competitions.";

  // Build absolute OG image URL
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;

  const ogUrl = `${baseUrl}/api/og/shooter/${shooterId}`;
  const alt = `${name} shooter dashboard`;

  return {
    title,
    description,
    openGraph: {
      title: name,
      description,
      type: "website",
      siteName: "SSI Scoreboard",
      images: [{ url: ogUrl, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
      images: [{ url: ogUrl, alt }],
    },
  };
}

export default async function ShooterPage({ params, searchParams }: Props) {
  const { shooterId } = await params;
  const { from } = await searchParams;
  const id = parseInt(shooterId, 10);

  // Validate `from` — only accept internal match paths to avoid open redirect
  const fromPath =
    from && /^\/match\/\d+\/\d+$/.test(from) ? from : undefined;

  return (
    <ShooterDashboardClient
      shooterId={isNaN(id) ? null : id}
      from={fromPath}
    />
  );
}
