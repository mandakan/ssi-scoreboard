import type { Metadata } from "next";
import { headers } from "next/headers";
import MatchPageClient from "./match-page-client";

interface PageProps {
  params: Promise<{ ct: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Override the OG/Twitter image when competitor IDs are present in the URL.
 * The layout's generateMetadata handles title + description (no search params
 * there). This page-level metadata merges on top and swaps in the competitor-
 * specific OG image URL when ?competitors=... is present.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const competitors =
    typeof sp.competitors === "string" ? sp.competitors : null;

  if (!competitors) return {};

  const { ct, id } = await params;
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

  const ogUrl = `${baseUrl}/api/og/match/${ct}/${id}?competitors=${competitors}`;

  return {
    openGraph: { images: [{ url: ogUrl, width: 1200, height: 630 }] },
    twitter: { images: [{ url: ogUrl }] },
  };
}

export default function MatchPage() {
  return <MatchPageClient />;
}
