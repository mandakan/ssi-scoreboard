import type { Metadata } from "next";
import { headers } from "next/headers";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MatchShell } from "@/components/match-shell";
import { fetchMatchData } from "@/lib/match-data";
import { isSameMatchPath } from "@/lib/match-routes";
import { fetchOgMatchData } from "@/lib/og-data";
import { matchQueryKey } from "@/lib/query-keys";
import { usageTelemetry, bucketScoring } from "@/lib/usage-telemetry";

interface Props {
  params: Promise<{ ct: string; id: string }>;
  children: React.ReactNode;
}

/**
 * Detect whether this server render is a soft navigation within the same
 * match (a tab switch, or the client appending ?competitors=... to the URL).
 * Without this guard a single page open would fire match-view several times
 * because Next.js re-runs the layout on navigation. We compare the Referer
 * path against the current match, across all its tabs -- external arrivals
 * never have it set to the same match, real soft navigations always do.
 *
 * Fails open (returns false) when Referer is missing -- accept the
 * occasional over-count rather than miss legitimate first-page-loads.
 */
async function isSameMatchSoftNav(ct: string, id: string): Promise<boolean> {
  try {
    const h = await headers();
    const referer = h.get("referer") ?? "";
    if (!referer) return false;
    const path = new URL(referer).pathname;
    return isSameMatchPath(path, ct, id);
  } catch {
    return false;
  }
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
  const t0 = performance.now();
  const match = await fetchOgMatchData(ct, id);
  console.log(JSON.stringify({
    route: "match-layout-metadata",
    ct, id,
    match_found: match !== null,
    ms_og_fetch: Math.round(performance.now() - t0),
  }));

  if (!match) {
    return { title: "Match not found — SSI Scoreboard" };
  }

  const title = match.name;

  // Build a human-readable description from available metadata.
  // Skip venue if it looks like raw GPS coordinates (e.g. "59.589885,17.840675").
  const isGps = match.venue ? /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(match.venue.trim()) : false;
  const descParts = [
    !isGps ? match.venue : null,
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

/**
 * Prefetch match data server-side so the client's useMatchQuery resolves
 * immediately from the TanStack Query hydration cache, eliminating the
 * client-side /api/match round-trip. One fetchMatchData per layout render,
 * shared by all three tabs.
 */
export default async function MatchLayout({ params, children }: Props) {
  const { ct, id } = await params;
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: matchQueryKey(ct, id),
    queryFn: async () => {
      const result = await fetchMatchData(ct, id);
      console.log(JSON.stringify({
        route: "match-layout-ssr",
        ct, id,
        prefetch_status: result ? "success" : "not_found",
        cache_hit: result !== null && result.cachedAt !== null,
        ms_fetch: result ? Math.round(result.msFetch) : null,
      }));
      if (!result) throw new Error("Match not found");
      // Fire match-view telemetry once per real page open. Skipped on
      // same-match soft navigations (see isSameMatchSoftNav above).
      const ctNum = parseInt(ct, 10);
      if (!isNaN(ctNum) && !(await isSameMatchSoftNav(ct, id))) {
        usageTelemetry({
          op: "match-view",
          ct: ctNum,
          level: result.data.level ?? null,
          region: result.data.region ?? null,
          scoringBucket: bucketScoring(result.data.scoring_pct ?? 0),
          cacheHit: result.cachedAt !== null,
          accessReason: result.data.access_reason.kind,
        });
      }
      return result.data;
    },
  });

  // Only dehydrate successfully prefetched queries. If the server-side fetch
  // fails (no API key in test/dev, cold cache), we must NOT propagate the
  // error state to the client -- TanStack Query v5 dehydrates errors by
  // default, which would stop the client from retrying via /api/match.
  return (
    <HydrationBoundary
      state={dehydrate(queryClient, {
        shouldDehydrateQuery: (query) => query.state.status === "success",
      })}
    >
      <MatchShell ct={ct} id={id}>{children}</MatchShell>
    </HydrationBoundary>
  );
}
