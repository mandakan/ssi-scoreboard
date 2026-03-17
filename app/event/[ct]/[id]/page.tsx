import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchOgMatchData } from "@/lib/og-data";
import { EventRedirect } from "./event-redirect";

interface Props {
  params: Promise<{ ct: string; id: string }>;
}

const SSI_BASE = "https://shootnscoreit.com/event";

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
    return { title: "Redirecting to ShootNScoreIt…" };
  }

  const title = match.name;
  const isGps = match.venue
    ? /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(match.venue.trim())
    : false;
  const descParts = [
    !isGps ? match.venue : null,
    match.date ? formatDate(match.date) : null,
    match.level,
  ].filter(Boolean);
  const description =
    descParts.length > 0
      ? descParts.join(" \u00b7 ")
      : "IPSC match on ShootNScoreIt";

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

/**
 * OG proxy page — serves rich Open Graph meta tags to social-media crawlers,
 * then redirects real browsers to the SSI match page.
 *
 * Match organizers can share `/event/{ct}/{id}` links instead of the raw SSI
 * URL to get the improved OG images in Slack, Discord, Facebook, etc.
 */
export default async function EventRedirectPage({ params }: Props) {
  const { ct, id } = await params;
  const ssiUrl = `${SSI_BASE}/${ct}/${id}/`;

  return <EventRedirect url={ssiUrl} />;
}
