import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchOgMatchData } from "@/lib/og-data";

interface Props {
  params: Promise<{ ct: string; id: string }>;
  children: React.ReactNode;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { ct, id } = await params;
  const match = await fetchOgMatchData(ct, id);

  if (!match) {
    return { title: "Match not found — SSI Scoreboard" };
  }

  const title = match.name;

  // Build a human-readable description from available metadata
  const descParts = [
    match.venue,
    match.date ? formatDate(match.date) : null,
    match.level,
  ].filter(Boolean);
  const description =
    descParts.length > 0
      ? descParts.join(" \u00b7 ")
      : "IPSC match comparison on SSI Scoreboard";

  // Build absolute OG image URL
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;

  const ogUrl = `${baseUrl}/api/og/match/${ct}/${id}`;
  const alt = match.venue ? `${title} at ${match.venue}` : title;

  return {
    title: `${title} — SSI Scoreboard`,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "SSI Scoreboard",
      images: [{ url: ogUrl, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: ogUrl, alt }],
    },
  };
}

export default function MatchLayout({ children }: Pick<Props, "children">) {
  return children;
}
