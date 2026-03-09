// Server-only — fetches match/shooter metadata for OG images and page metadata.
// Uses cached data (GraphQL cache for matches, Redis index for shooters).

import { fetchRawMatchData } from "@/lib/match-data";
import { extractDivision } from "@/lib/divisions";
import { decodeShooterId } from "@/lib/shooter-index";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import type { CompetitorInfo, ShooterDashboardResponse } from "@/lib/types";

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
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
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
    const { data } = await fetchRawMatchData(ctNum, id);

    if (!data.event) return null;
    const ev = data.event;

    const competitors: CompetitorInfo[] = (
      ev.competitors_approved_w_wo_results_not_dnf ?? []
    ).map((c) => ({
      id: parseInt(c.id, 10),
      shooterId: decodeShooterId(c.shooter?.id),
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
      competitor_number: c.number ?? "",
      club: c.club ?? null,
      division: extractDivision(c),
      region: c.region || null,
      region_display: c.get_region_display || null,
      category: c.category || null,
      ics_alias: c.ics_alias || null,
      license: c.license || null,
    }));

    // Only use the image URL if it's non-empty (API returns "" for unset images)
    const imageUrl = ev.image?.url?.trim() || null;
    const imageWidth = imageUrl && ev.image?.width ? ev.image.width : null;
    const imageHeight = imageUrl && ev.image?.height ? ev.image.height : null;

    return {
      name: ev.name,
      venue: ev.venue ?? null,
      date: ev.starts ?? null,
      level: ev.level ?? null,
      region: ev.region ?? null,
      stagesCount: ev.stages_count ?? 0,
      competitorsCount: ev.competitors_count ?? competitors.length,
      imageUrl,
      imageWidth,
      imageHeight,
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

// ── Shooter OG data ──────────────────────────────────────────────────────

export interface OgShooterData {
  name: string;
  club: string | null;
  division: string | null;
  region: string | null;
  region_display: string | null;
  category: string | null;
  matchCount: number;
  totalStages: number;
  overallAvgHF: number | null;
  overallMatchPct: number | null;
  aPercent: number | null;
  hfTrendSlope: number | null;
  dateRange: { from: string | null; to: string | null };
}

/**
 * Fetch shooter data needed for OG images and page metadata.
 * Reads from the pre-computed dashboard cache (same key the shooter API uses,
 * 5min TTL). Falls back to profile + match count from the Redis index.
 *
 * Returns null if the shooter is not found in Redis at all.
 */
export async function fetchOgShooterData(
  shooterId: number,
  timeoutMs: number = METADATA_FETCH_TIMEOUT_MS,
): Promise<OgShooterData | null> {
  return Promise.race([
    fetchOgShooterDataImpl(shooterId),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    ),
  ]);
}

async function fetchOgShooterDataImpl(
  shooterId: number,
): Promise<OgShooterData | null> {
  try {
    // Try pre-computed dashboard first (has full aggregate stats)
    const dashboardKey = `computed:shooter:${String(shooterId)}:dashboard`;
    const dashboardRaw = await cache.get(dashboardKey);
    if (dashboardRaw) {
      const dashboard = JSON.parse(dashboardRaw) as ShooterDashboardResponse;
      return {
        name: dashboard.profile?.name ?? `Shooter #${String(shooterId)}`,
        club: dashboard.profile?.club ?? null,
        division: dashboard.profile?.division ?? null,
        region: dashboard.profile?.region ?? null,
        region_display: dashboard.profile?.region_display ?? null,
        category: dashboard.profile?.category ?? null,
        matchCount: dashboard.matchCount,
        totalStages: dashboard.stats.totalStages,
        overallAvgHF: dashboard.stats.overallAvgHF,
        overallMatchPct: dashboard.stats.overallMatchPct,
        aPercent: dashboard.stats.aPercent,
        hfTrendSlope: dashboard.stats.hfTrendSlope,
        dateRange: dashboard.stats.dateRange,
      };
    }

    // Fall back to profile + match count from the ShooterStore
    const [profile, matchRefs] = await Promise.all([
      db.getShooterProfile(shooterId),
      db.getShooterMatches(shooterId),
    ]);

    if (!profile && matchRefs.length === 0) return null;

    return {
      name: profile?.name ?? `Shooter #${String(shooterId)}`,
      club: profile?.club ?? null,
      division: profile?.division ?? null,
      region: profile?.region ?? null,
      region_display: profile?.region_display ?? null,
      category: profile?.category ?? null,
      matchCount: matchRefs.length,
      totalStages: 0,
      overallAvgHF: null,
      overallMatchPct: null,
      aPercent: null,
      hfTrendSlope: null,
      dateRange: { from: null, to: null },
    };
  } catch (err) {
    console.error("[og] Failed to fetch shooter data:", err);
    return null;
  }
}
