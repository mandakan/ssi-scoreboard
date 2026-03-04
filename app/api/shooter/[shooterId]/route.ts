import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { gqlCacheKey } from "@/lib/graphql";
import { decodeShooterId } from "@/lib/shooter-index";
import type { ShooterProfile } from "@/lib/shooter-index";
import { parseRawScorecards } from "@/lib/scorecard-data";
import { formatDivisionDisplay } from "@/lib/divisions";
import { computeAggregateStats } from "@/lib/shooter-stats";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import type {
  ShooterDashboardResponse,
  ShooterMatchSummary,
} from "@/lib/types";
import type { RawScorecardsData } from "@/lib/scorecard-data";
import type { RawScorecard } from "@/app/api/compare/logic";

/** Dashboard result TTL — 5 minutes. */
const DASHBOARD_TTL = 300;

/** Maximum number of recent matches to process. */
const MAX_MATCHES = 50;

// ─── Local types mirroring the cached raw GraphQL responses ──────────────────

interface CacheEntry<T> {
  data: T;
  cachedAt: string;
  v?: number;
}

interface RawCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  club?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  shooter?: { id: string } | null;
}

interface RawMatchEvent {
  name: string;
  venue?: string | null;
  starts?: string | null;
  level?: string | null;
  region?: string | null;
  competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
}

interface RawMatchData {
  event: RawMatchEvent | null;
}

// ─── Computation helpers ──────────────────────────────────────────────────────

/**
 * Compute per-match summary for one shooter from raw scorecard data.
 * Returns avgHF, matchPct, and hit-zone totals.
 */
function computeMatchStats(
  competitorId: number,
  division: string | null,
  rawScorecards: RawScorecard[],
): {
  stageCount: number;
  avgHF: number | null;
  matchPct: number | null;
  totalA: number;
  totalC: number;
  totalD: number;
  totalMiss: number;
  totalNoShoots: number;
} {
  const myCards = rawScorecards.filter(
    (sc) =>
      sc.competitor_id === competitorId &&
      !sc.dnf &&
      !sc.dq &&
      !sc.zeroed &&
      sc.hit_factor != null &&
      sc.hit_factor >= 0,
  );

  const stageCount = myCards.length;
  if (stageCount === 0) {
    return {
      stageCount: 0,
      avgHF: null,
      matchPct: null,
      totalA: 0,
      totalC: 0,
      totalD: 0,
      totalMiss: 0,
      totalNoShoots: 0,
    };
  }

  const hfSum = myCards.reduce((s, sc) => s + (sc.hit_factor ?? 0), 0);
  const avgHF = hfSum / stageCount;

  // Compute division-based match %
  const stagePcts: number[] = [];
  if (division) {
    for (const card of myCards) {
      // Find division leader HF for this stage
      const divCards = rawScorecards.filter(
        (sc) =>
          sc.stage_id === card.stage_id &&
          !sc.dnf &&
          !sc.dq &&
          !sc.zeroed &&
          sc.hit_factor != null &&
          sc.competitor_division === card.competitor_division,
      );
      const leaderHF = divCards.reduce(
        (max, sc) => Math.max(max, sc.hit_factor ?? 0),
        0,
      );
      if (leaderHF > 0 && card.hit_factor != null) {
        stagePcts.push((card.hit_factor / leaderHF) * 100);
      }
    }
  }
  const matchPct =
    stagePcts.length > 0
      ? stagePcts.reduce((a, b) => a + b, 0) / stagePcts.length
      : null;

  // Hit-zone totals
  const totalA = myCards.reduce((s, sc) => s + (sc.a_hits ?? 0), 0);
  const totalC = myCards.reduce((s, sc) => s + (sc.c_hits ?? 0), 0);
  const totalD = myCards.reduce((s, sc) => s + (sc.d_hits ?? 0), 0);
  const totalMiss = myCards.reduce((s, sc) => s + (sc.miss_count ?? 0), 0);
  const totalNoShoots = myCards.reduce((s, sc) => s + (sc.no_shoots ?? 0), 0);

  return {
    stageCount,
    avgHF,
    matchPct,
    totalA,
    totalC,
    totalD,
    totalMiss,
    totalNoShoots,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const { shooterId: shooterIdStr } = await params;
  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return NextResponse.json({ error: "Invalid shooterId" }, { status: 400 });
  }

  // ── 1. Check computed dashboard cache ────────────────────────────────────
  const dashboardKey = `computed:shooter:${shooterId}:dashboard`;
  try {
    const cached = await cache.get(dashboardKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ShooterDashboardResponse;
      return NextResponse.json(parsed);
    }
  } catch { /* ignore cache errors */ }

  // ── 2. Load profile and match refs from ShooterStore ─────────────────────
  let profile: ShooterProfile | null = null;
  let matchRefs: string[] = [];
  try {
    [profile, matchRefs] = await Promise.all([
      db.getShooterProfile(shooterId),
      db.getShooterMatches(shooterId),
    ]);
  } catch { /* ignore store errors */ }

  if (!profile && matchRefs.length === 0) {
    return NextResponse.json({ error: "Shooter not found" }, { status: 404 });
  }

  const totalMatchCount = matchRefs.length;

  // ── 3. Process most recent N matches ─────────────────────────────────────
  // matchRefs is sorted ascending by timestamp; take the last MAX_MATCHES
  const recentRefs = matchRefs.slice(-MAX_MATCHES).reverse(); // newest first

  // Load match + scorecard cache entries in parallel (batched to avoid flood)
  const BATCH = 10;
  const matchSummaries: ShooterMatchSummary[] = [];

  for (let i = 0; i < recentRefs.length; i += BATCH) {
    const batch = recentRefs.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (ref) => {
        const parts = ref.split(":");
        if (parts.length < 2) return null;
        const [ct, ...idParts] = parts;
        const matchId = idParts.join(":");
        if (!ct || !matchId) return null;

        const ctNum = parseInt(ct, 10);
        if (isNaN(ctNum)) return null;

        const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id: matchId });
        const scorecardsKey = gqlCacheKey("GetMatchScorecards", {
          ct: ctNum,
          id: matchId,
        });

        let matchRaw: string | null = null;
        let scorecardsRaw: string | null = null;
        try {
          [matchRaw, scorecardsRaw] = await Promise.all([
            cache.get(matchKey),
            cache.get(scorecardsKey),
          ]);
        } catch { return null; }

        if (!matchRaw) return null;

        try {
          const matchEntry = JSON.parse(matchRaw) as CacheEntry<RawMatchData>;
          // Only process entries with the current schema version (need shooter.id)
          if (matchEntry.v !== CACHE_SCHEMA_VERSION) return null;
          if (!matchEntry.data?.event) return null;

          const ev = matchEntry.data.event;

          // Find this shooter's competitor in the match
          const competitor = (
            ev.competitors_approved_w_wo_results_not_dnf ?? []
          ).find((c) => decodeShooterId(c.shooter?.id) === shooterId);

          if (!competitor) return null;

          const competitorId = parseInt(competitor.id, 10);
          const division = formatDivisionDisplay(
            competitor.get_handgun_div_display ?? competitor.handgun_div,
            competitor.shoots_handgun_major,
          );

          // Count competitors in the same formatted division
          const allCompetitors = ev.competitors_approved_w_wo_results_not_dnf ?? [];
          let competitorsInDivision: number | null = null;
          if (division) {
            competitorsInDivision = allCompetitors.filter((c) => {
              const cDiv = formatDivisionDisplay(
                c.get_handgun_div_display ?? c.handgun_div,
                c.shoots_handgun_major,
              );
              return cDiv === division;
            }).length;
          }

          // Compute stats from scorecards if available
          let stageCount = 0;
          let avgHF: number | null = null;
          let matchPct: number | null = null;
          let totalA = 0;
          let totalC = 0;
          let totalD = 0;
          let totalMiss = 0;
          let totalNoShoots = 0;

          if (scorecardsRaw) {
            try {
              const scEntry = JSON.parse(
                scorecardsRaw,
              ) as CacheEntry<RawScorecardsData>;
              const rawScorecards = parseRawScorecards(
                scEntry.data ?? { event: null },
              );
              const stats = computeMatchStats(
                competitorId,
                division,
                rawScorecards,
              );
              stageCount = stats.stageCount;
              avgHF = stats.avgHF;
              matchPct = stats.matchPct;
              totalA = stats.totalA;
              totalC = stats.totalC;
              totalD = stats.totalD;
              totalMiss = stats.totalMiss;
              totalNoShoots = stats.totalNoShoots;
            } catch { /* skip scorecard stats on parse error */ }
          }

          const summary: ShooterMatchSummary = {
            ct,
            matchId,
            name: ev.name,
            date: ev.starts ?? null,
            venue: ev.venue ?? null,
            level: ev.level ?? null,
            region: ev.region ?? null,
            division,
            competitorId,
            competitorsInDivision,
            stageCount,
            avgHF,
            matchPct,
            totalA,
            totalC,
            totalD,
            totalMiss,
            totalNoShoots,
          };
          return summary;
        } catch { return null; }
      }),
    );

    for (const result of batchResults) {
      if (result) matchSummaries.push(result);
    }
  }

  // ── 4. Compute cross-match aggregates ─────────────────────────────────────
  const stats = computeAggregateStats(matchSummaries);

  const response: ShooterDashboardResponse = {
    shooterId,
    profile,
    matchCount: totalMatchCount,
    matches: matchSummaries,
    stats,
  };

  // ── 5. Cache the result ───────────────────────────────────────────────────
  try {
    await cache.set(dashboardKey, JSON.stringify(response), DASHBOARD_TTL);
  } catch { /* ignore */ }

  console.log(
    JSON.stringify({
      route: "shooter-dashboard",
      shooterId,
      matchCount: totalMatchCount,
      matchesProcessed: matchSummaries.length,
    }),
  );

  return NextResponse.json(response);
}
