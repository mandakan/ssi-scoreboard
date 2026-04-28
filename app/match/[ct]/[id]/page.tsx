import type { Metadata } from "next";
import { headers } from "next/headers";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import MatchPageClient from "./match-page-client";
import { fetchMatchData } from "@/lib/match-data";
import { matchQueryKey } from "@/lib/query-keys";
import { usageTelemetry, bucketScoring } from "@/lib/usage-telemetry";

/**
 * Detect whether this server render is a soft navigation within the same
 * match (e.g. the client appended ?competitors=... to the URL). Without
 * this guard a single user-facing page open would fire match-view 2-3
 * times because Next.js re-runs the page server component on every URL
 * change. We compare the Referer header against the current ct/id —
 * external arrivals never have it set to the same match, real soft
 * navigations within a match always do.
 *
 * Fails open (returns false) when Referer is missing — accept the
 * occasional over-count rather than miss legitimate first-page-loads.
 */
async function isSameMatchSoftNav(ct: string, id: string): Promise<boolean> {
  try {
    const h = await headers();
    const referer = h.get("referer") ?? "";
    if (!referer) return false;
    const path = new URL(referer).pathname;
    return path === `/match/${ct}/${id}`;
  } catch {
    return false;
  }
}

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

/**
 * Prefetch match data server-side so the client's useMatchQuery resolves
 * immediately from the TanStack Query hydration cache — eliminating the
 * client-side /api/match round-trip and its ~900ms contribution to LCP.
 */
export default async function MatchPage({ params }: PageProps) {
  const { ct, id } = await params;

  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: matchQueryKey(ct, id),
    queryFn: async () => {
      const result = await fetchMatchData(ct, id);
      console.log(JSON.stringify({
        route: "match-page-ssr",
        ct, id,
        prefetch_status: result ? "success" : "not_found",
        cache_hit: result !== null && result.cachedAt !== null,
        ms_fetch: result ? Math.round(result.msFetch) : null,
      }));
      if (!result) throw new Error("Match not found");
      // Fire match-view telemetry once per real page open. Skipped on
      // same-match soft navigations (see isSameMatchSoftNav above) so the
      // counter doesn't triple-fire when the client appends ?competitors=
      // or other URL state.
      const ctNum = parseInt(ct, 10);
      if (!isNaN(ctNum) && !(await isSameMatchSoftNav(ct, id))) {
        usageTelemetry({
          op: "match-view",
          ct: ctNum,
          level: result.data.level ?? null,
          region: result.data.region ?? null,
          scoringBucket: bucketScoring(result.data.scoring_completed ?? 0),
          cacheHit: result.cachedAt !== null,
        });
      }
      return result.data;
    },
  });

  // Only dehydrate successfully prefetched queries. If the server-side fetch
  // fails (e.g. no API key in test/dev, cache miss on a cold node), we must
  // NOT propagate the error state to the client — TanStack Query v5 dehydrates
  // errors by default, which would prevent the client from retrying via its
  // own /api/match fetch. An empty dehydrated state causes the client to
  // start fresh, which is exactly the graceful-degradation behaviour we want.
  return (
    <HydrationBoundary
      state={dehydrate(queryClient, {
        shouldDehydrateQuery: (query) => query.state.status === "success",
      })}
    >
      <MatchPageClient />
    </HydrationBoundary>
  );
}
