import type { Metadata } from "next";
import { ShooterDashboardClient } from "./shooter-dashboard-client";

interface Props {
  params: Promise<{ shooterId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shooterId } = await params;
  const title = `Shooter #${shooterId} — SSI Scoreboard`;
  const description =
    "Personal match history and performance stats across IPSC competitions.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "SSI Scoreboard",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ShooterPage({ params }: Props) {
  const { shooterId } = await params;
  const id = parseInt(shooterId, 10);

  return <ShooterDashboardClient shooterId={isNaN(id) ? null : id} />;
}
