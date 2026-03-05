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
import { evaluateAchievements } from "@/lib/achievements/evaluate";
import type {
  ShooterDashboardResponse,
  ShooterMatchSummary,
  UpcomingMatch,
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
  totalProcedurals: number;
  dq: boolean;
  perfectStages: number;
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
      totalProcedurals: 0,
      dq: false,
      perfectStages: 0,
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
  const totalProcedurals = myCards.reduce((s, sc) => s + (sc.procedurals ?? 0), 0);
  const dq = rawScorecards.some(
    (sc) => sc.competitor_id === competitorId && sc.dq,
  );

  // Perfect stages: all A-hits, no C/D/miss/no-shoot/procedural, and at least one A-hit
  const perfectStages = myCards.filter(
    (sc) =>
      (sc.a_hits ?? 0) > 0 &&
      (sc.c_hits ?? 0) === 0 &&
      (sc.d_hits ?? 0) === 0 &&
      (sc.miss_count ?? 0) === 0 &&
      (sc.no_shoots ?? 0) === 0 &&
      (sc.procedurals ?? 0) === 0,
  ).length;

  return {
    stageCount,
    avgHF,
    matchPct,
    totalA,
    totalC,
    totalD,
    totalMiss,
    totalNoShoots,
    totalProcedurals,
    dq,
    perfectStages,
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

  // ── 2. Load profile, match refs, and upcoming refs from ShooterStore ────
  let profile: ShooterProfile | null = null;
  let matchRefs: string[] = [];
  let upcomingRefs: string[] = [];
  try {
    [profile, matchRefs, upcomingRefs] = await Promise.all([
      db.getShooterProfile(shooterId),
      db.getShooterMatches(shooterId),
      db.getUpcomingMatches(shooterId),
    ]);
  } catch { /* ignore store errors */ }

  if (!profile && matchRefs.length === 0) {
    return NextResponse.json({ error: "Shooter not found" }, { status: 404 });
  }

  // Exclude upcoming refs from regular match processing
  const upcomingSet = new Set(upcomingRefs);
  const pastRefs = matchRefs.filter((ref) => !upcomingSet.has(ref));

  const totalMatchCount = pastRefs.length;

  // ── 3. Process most recent N matches ─────────────────────────────────────
  // pastRefs is sorted ascending by timestamp; take the last MAX_MATCHES
  const recentRefs = pastRefs.slice(-MAX_MATCHES).reverse(); // newest first

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
          let totalProcedurals = 0;
          let wasDQ = false;
          let perfectStagesCount = 0;

          if (scorecardsRaw) {
            try {
              const scEntry = JSON.parse(
                scorecardsRaw,
              ) as CacheEntry<RawScorecardsData>;
              const rawScorecards = parseRawScorecards(
                scEntry.data ?? { event: null },
              );
              const mStats = computeMatchStats(
                competitorId,
                division,
                rawScorecards,
              );
              stageCount = mStats.stageCount;
              avgHF = mStats.avgHF;
              matchPct = mStats.matchPct;
              totalA = mStats.totalA;
              totalC = mStats.totalC;
              totalD = mStats.totalD;
              totalMiss = mStats.totalMiss;
              totalNoShoots = mStats.totalNoShoots;
              totalProcedurals = mStats.totalProcedurals;
              wasDQ = mStats.dq;
              perfectStagesCount = mStats.perfectStages;
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
            totalProcedurals,
            dq: wasDQ,
            perfectStages: perfectStagesCount,
          };
          return summary;
        } catch { return null; }
      }),
    );

    for (const result of batchResults) {
      if (result) matchSummaries.push(result);
    }
  }

  // ── 3b. Resolve upcoming match metadata ──────────────────────────────────
  const upcomingMatches: UpcomingMatch[] = [];
  for (const ref of upcomingRefs) {
    const parts = ref.split(":");
    if (parts.length < 2) continue;
    const [ct, ...idParts] = parts;
    const matchId = idParts.join(":");
    if (!ct || !matchId) continue;
    const ctNum = parseInt(ct, 10);
    if (isNaN(ctNum)) continue;

    const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id: matchId });
    let matchRaw: string | null = null;
    try {
      matchRaw = await cache.get(matchKey);
    } catch { continue; }
    if (!matchRaw) continue;

    try {
      const matchEntry = JSON.parse(matchRaw) as CacheEntry<RawMatchData>;
      if (matchEntry.v !== CACHE_SCHEMA_VERSION) continue;
      if (!matchEntry.data?.event) continue;

      const ev = matchEntry.data.event;
      const competitor = (
        ev.competitors_approved_w_wo_results_not_dnf ?? []
      ).find((c) => decodeShooterId(c.shooter?.id) === shooterId);
      if (!competitor) continue;

      upcomingMatches.push({
        ct,
        matchId,
        name: ev.name,
        date: ev.starts ?? null,
        venue: ev.venue ?? null,
        level: ev.level ?? null,
        division: formatDivisionDisplay(
          competitor.get_handgun_div_display ?? competitor.handgun_div,
          competitor.shoots_handgun_major,
        ),
        competitorId: parseInt(competitor.id, 10),
      });
    } catch { /* skip on parse error */ }
  }

  // ── 4. Compute cross-match aggregates ─────────────────────────────────────
  const stats = computeAggregateStats(matchSummaries);

  // ── 5. Evaluate achievements ───────────────────────────────────────────────
  let storedAchievements: import("@/lib/achievements/types").StoredAchievement[] = [];
  try {
    storedAchievements = await db.getShooterAchievements(shooterId);
  } catch { /* ignore DB errors */ }

  const { achievements, newUnlocks } = evaluateAchievements(
    { matchCount: totalMatchCount, matches: matchSummaries, stats },
    storedAchievements,
  );

  // Persist new unlocks (fire-and-forget)
  if (newUnlocks.length > 0) {
    db.saveShooterAchievements(shooterId, newUnlocks).catch(() => {});
  }

  const response: ShooterDashboardResponse = {
    shooterId,
    profile,
    matchCount: totalMatchCount,
    matches: matchSummaries,
    stats,
    achievements,
    ...(upcomingMatches.length > 0 ? { upcomingMatches } : {}),
  };

  // ── 6. Cache the result ───────────────────────────────────────────────────
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
