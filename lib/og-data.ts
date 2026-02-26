// Server-only — fetches match metadata for OG image and page metadata generation.
// Uses the same cached GraphQL path as the match API route.

import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY } from "@/lib/graphql";
import { formatDivisionDisplay } from "@/lib/divisions";
import type { CompetitorInfo } from "@/lib/types";

// ── Raw GraphQL response shapes (minimal subset for OG) ────────────────

interface RawOgCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
}

interface RawOgMatchData {
  event: {
    name: string;
    venue?: string | null;
    starts: string | null;
    scoring_completed?: string | number | null;
    region?: string | null;
    level?: string | null;
    stages_count?: number;
    competitors_count?: number;
    competitors_approved_w_wo_results_not_dnf?: RawOgCompetitor[];
  } | null;
}

// ── Public types ────────────────────────────────────────────────────────

export interface OgMatchData {
  name: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  region: string | null;
  stagesCount: number;
  competitorsCount: number;
  scoringCompleted: number;
  competitors: CompetitorInfo[];
}

// ── Fetch helper ────────────────────────────────────────────────────────

// Maximum time to wait for match data during metadata generation.
// In production the data is almost always in Redis cache (sub-ms).
// The timeout prevents slow upstream responses from blocking client-side
// soft navigations (Next.js re-runs generateMetadata on router.replace).
const METADATA_FETCH_TIMEOUT_MS = 1500;

/**
 * Fetch match data needed for OG images and page metadata.
 * Uses the same cached GraphQL query as the match API route, so in most
 * cases this is a Redis cache hit (sub-millisecond on Docker).
 *
 * @param timeoutMs – Maximum time to wait. Defaults to
 * METADATA_FETCH_TIMEOUT_MS (1500ms) which is tight enough to avoid
 * blocking soft navigations in generateMetadata(). The OG image route
 * passes a longer timeout because social-media crawlers are patient.
 *
 * Returns null if the match cannot be found, the fetch fails, or the
 * fetch exceeds the timeout.
 */
export async function fetchOgMatchData(
  ct: string,
  id: string,
  timeoutMs: number = METADATA_FETCH_TIMEOUT_MS,
): Promise<OgMatchData | null> {
  return Promise.race([
    fetchOgMatchDataImpl(ct, id),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    ),
  ]);
}

async function fetchOgMatchDataImpl(
  ct: string,
  id: string,
): Promise<OgMatchData | null> {
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) return null;

  try {
    const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
    const { data } = await cachedExecuteQuery<RawOgMatchData>(
      matchKey,
      MATCH_QUERY,
      { ct: ctNum, id },
      30,
    );

    if (!data.event) return null;
    const ev = data.event;

    const competitors: CompetitorInfo[] = (
      ev.competitors_approved_w_wo_results_not_dnf ?? []
    ).map((c) => ({
      id: parseInt(c.id, 10),
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
      competitor_number: c.number ?? "",
      club: c.club ?? null,
      division: formatDivisionDisplay(
        c.get_handgun_div_display ?? c.handgun_div,
        c.shoots_handgun_major,
      ),
    }));

    return {
      name: ev.name,
      venue: ev.venue ?? null,
      date: ev.starts ?? null,
      level: ev.level ?? null,
      region: ev.region ?? null,
      stagesCount: ev.stages_count ?? 0,
      competitorsCount: ev.competitors_count ?? competitors.length,
      scoringCompleted:
        ev.scoring_completed != null
          ? Math.round(parseFloat(String(ev.scoring_completed)))
          : 0,
      competitors,
    };
  } catch (err) {
    console.error("[og] Failed to fetch match data:", err);
    return null;
  }
}
