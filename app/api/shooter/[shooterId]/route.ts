import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { gqlCacheKey, cachedExecuteQuery, UPCOMING_STATUS_QUERY } from "@/lib/graphql";
import { getMatchDataWithFallback } from "@/lib/match-data-store";
import { decodeShooterId } from "@/lib/shooter-index";
import { reportError } from "@/lib/error-telemetry";
import { usageTelemetry, bucketCount } from "@/lib/usage-telemetry";
import type { ShooterProfile } from "@/lib/shooter-index";
import { parseRawScorecards } from "@/lib/scorecard-data";
import { extractDivision } from "@/lib/divisions";
import { computeAggregateStats } from "@/lib/shooter-stats";
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
  get_division_display?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  shooter?: { id: string } | null;
}

interface RawSquad {
  id: string;
  competitors?: Array<{ id: string }> | null;
}

interface RawMatchEvent {
  name: string;
  venue?: string | null;
  starts?: string | null;
  level?: string | null;
  region?: string | null;
  get_full_rule_display?: string | null;
  registration_starts?: string | null;
  registration_closes?: string | null;
  squadding_starts?: string | null;
  squadding_closes?: string | null;
  is_registration_possible?: boolean;
  is_squadding_possible?: boolean;
  competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  squads?: RawSquad[] | null;
}

interface RawMatchData {
  event: RawMatchEvent | null;
}

// Lightweight response from UPCOMING_STATUS_QUERY — only competitor IDs + squads.
interface RawUpcomingStatusEvent {
  is_registration_possible?: boolean;
  is_squadding_possible?: boolean;
  registration_starts?: string | null;
  registration_closes?: string | null;
  squadding_starts?: string | null;
  squadding_closes?: string | null;
  competitors_approved_w_wo_results_not_dnf?: Array<{
    id: string;
    shooter?: { id: string } | null;
  }>;
  squads?: Array<{
    competitors?: Array<{ id: string }> | null;
  }> | null;
}

interface RawUpcomingStatusData {
  event: RawUpcomingStatusEvent | null;
}

/** TTL for the lightweight upcoming status cache — 30 minutes. */
const UPCOMING_STATUS_TTL = 1800;

/** Result from resolveShooterStatus — includes fresh registration/squadding dates. */
interface ShooterStatusResult {
  ref: string;
  competitorId: number;
  isRegistered: boolean;
  isSquadded: boolean;
  // Fresh dates from the API (may be null if the source didn't include them)
  registrationStarts: string | null;
  registrationCloses: string | null;
  squaddingStarts: string | null;
  squaddingCloses: string | null;
  isRegistrationPossible: boolean;
  isSquaddingPossible: boolean;
}

/**
 * Extract registration + squad status for a specific shooter from match event data.
 * Works with both the full RawMatchEvent (from cached GetMatch) and the lightweight
 * RawUpcomingStatusEvent (from GetUpcomingStatus) since they share the same shape
 * for competitor/squad ID fields.
 *
 * Also extracts fresh registration/squadding dates from the event data to override
 * potentially stale values in the matches domain table (e.g. rows written before
 * migration 0007 have null for these columns).
 */
function resolveShooterStatus(
  ref: string,
  ev: {
    competitors_approved_w_wo_results_not_dnf?: Array<{ id: string; shooter?: { id: string } | null }>;
    squads?: Array<{ competitors?: Array<{ id: string }> | null }> | null;
    registration_starts?: string | null;
    registration_closes?: string | null;
    squadding_starts?: string | null;
    squadding_closes?: string | null;
    is_registration_possible?: boolean;
    is_squadding_possible?: boolean;
  },
  shooterId: number,
): ShooterStatusResult {
  const competitors = ev.competitors_approved_w_wo_results_not_dnf ?? [];
  const competitor = competitors.find(
    (c) => decodeShooterId(c.shooter?.id) === shooterId,
  );
  const base: ShooterStatusResult = {
    ref,
    competitorId: 0,
    isRegistered: false,
    isSquadded: false,
    registrationStarts: ev.registration_starts ?? null,
    registrationCloses: ev.registration_closes ?? null,
    squaddingStarts: ev.squadding_starts ?? null,
    squaddingCloses: ev.squadding_closes ?? null,
    isRegistrationPossible: ev.is_registration_possible ?? false,
    isSquaddingPossible: ev.is_squadding_possible ?? false,
  };
  if (!competitor) return base;
  const competitorId = parseInt(competitor.id, 10) || 0;
  const squads = ev.squads ?? [];
  const isSquadded = squads.some(
    (s) => s.competitors?.some((sc) => sc.id === competitor.id) ?? false,
  );
  return { ...base, competitorId, isRegistered: true, isSquadded };
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
  consistencyIndex: number | null;
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
      consistencyIndex: null,
    };
  }

  const hfSum = myCards.reduce((s, sc) => s + (sc.hit_factor ?? 0), 0);
  const avgHF = hfSum / stageCount;

  // Consistency index: (1 - CV) * 100 where CV = stddev(stageHFs) / mean(stageHFs)
  let consistencyIndex: number | null = null;
  const hfs = myCards
    .map((sc) => sc.hit_factor ?? 0)
    .filter((hf) => hf > 0);
  if (hfs.length >= 2) {
    const mean = hfs.reduce((s, v) => s + v, 0) / hfs.length;
    if (mean > 0) {
      const variance =
        hfs.reduce((s, v) => s + (v - mean) ** 2, 0) / hfs.length;
      consistencyIndex = (1 - Math.sqrt(variance) / mean) * 100;
    }
  }

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
    consistencyIndex,
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

  // ── 0. Check GDPR suppression ────────────────────────────────────────────
  try {
    if (await db.isShooterSuppressed(shooterId)) {
      return NextResponse.json(
        { error: "This profile has been removed at the owner's request" },
        { status: 410 },
      );
    }
  } catch { /* if DB is unavailable, proceed normally */ }

  // ── 1. Check computed dashboard cache ────────────────────────────────────
  const dashboardKey = `computed:shooter:${shooterId}:dashboard`;
  try {
    const cached = await cache.get(dashboardKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ShooterDashboardResponse;
      usageTelemetry({
        op: "shooter-dashboard-view",
        matchCountBucket: bucketCount(parsed.matchCount),
        cacheHit: true,
      });
      return NextResponse.json(parsed);
    }
  } catch (err) {
    reportError("shooter.dashboard-cache-read", err, { shooterId });
  }

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
  } catch (err) {
    reportError("shooter.profile-load", err, { shooterId });
  }

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
            getMatchDataWithFallback(matchKey),
            getMatchDataWithFallback(scorecardsKey),
          ]);
        } catch { return null; }

        if (!matchRaw) return null;

        try {
          const matchEntry = JSON.parse(matchRaw) as CacheEntry<RawMatchData>;
          // Require at least v6, when shooter { id } was added to IpscCompetitorNode.
          // Entries older than v6 cannot identify the shooter and must be skipped.
          // We intentionally allow any version ≥ 6 so that D1 entries stored before
          // a recent schema bump are still usable — fields added in later versions
          // are accessed safely and extractDivision() has fallbacks for pre-v8 data.
          if (!matchEntry.v || matchEntry.v < 6) return null;
          if (!matchEntry.data?.event) return null;

          const ev = matchEntry.data.event;

          // Find this shooter's competitor in the match
          const competitor = (
            ev.competitors_approved_w_wo_results_not_dnf ?? []
          ).find((c) => decodeShooterId(c.shooter?.id) === shooterId);

          if (!competitor) return null;

          const competitorId = parseInt(competitor.id, 10);
          const division = extractDivision(competitor);

          // Count competitors in the same formatted division
          const allCompetitors = ev.competitors_approved_w_wo_results_not_dnf ?? [];
          let competitorsInDivision: number | null = null;
          if (division) {
            competitorsInDivision = allCompetitors.filter(
              (c) => extractDivision(c) === division,
            ).length;
          }

          // Build local-competitor-id → global-shooter-id map for squad lookup
          const shooterIdByCompetitorId = new Map<string, number>();
          for (const comp of allCompetitors) {
            const globalId = decodeShooterId(comp.shooter?.id);
            if (globalId) shooterIdByCompetitorId.set(comp.id, globalId);
          }

          // Build local-competitor-id → club map for same-club squad check
          const clubByCompetitorId = new Map<string, string | null>();
          for (const comp of allCompetitors) {
            clubByCompetitorId.set(comp.id, comp.club ?? null);
          }

          // Find which squad the shooter is in; collect squadmates' global IDs
          // and determine whether all members share the same club.
          let squadmateShooterIds: number[] = [];
          let squadAllSameClub = false;
          for (const squad of (ev.squads ?? [])) {
            const memberIds = (squad.competitors ?? []).map((c) => c.id);
            if (memberIds.includes(competitor.id)) {
              squadmateShooterIds = memberIds
                .filter((id) => id !== competitor.id)
                .flatMap((id) => {
                  const gid = shooterIdByCompetitorId.get(id);
                  return gid != null ? [gid] : [];
                });

              // Collect non-null clubs for all squad members (shooter included)
              const clubs = memberIds
                .map((id) => clubByCompetitorId.get(id) ?? null)
                .filter((c): c is string => !!c);
              squadAllSameClub =
                clubs.length >= 2 && clubs.every((c) => c === clubs[0]);
              break;
            }
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
          let consistencyIndexValue: number | null = null;

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
              consistencyIndexValue = mStats.consistencyIndex;
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
            discipline: ev.get_full_rule_display ?? null,
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
            consistencyIndex: consistencyIndexValue,
            squadmateShooterIds,
            squadAllSameClub,
          };
          return summary;
        } catch { return null; }
      }),
    );

    for (const result of batchResults) {
      if (result) matchSummaries.push(result);
    }
  }

  // ── 3b. Resolve upcoming match metadata + registration/squad status ────────
  // Two-tier approach: first check cached GetMatch data (free — no API call),
  // then fall back to a lightweight GraphQL query (cheap — only IDs + squads,
  // ~5-10% of GetMatch payload, cached for 30min).
  const upcomingMatches: UpcomingMatch[] = [];
  if (upcomingRefs.length > 0) {
    let matchMetaMap = new Map<string, import("@/lib/types").MatchRecord>();
    try {
      matchMetaMap = await db.getMatchesByRefs(upcomingRefs);
    } catch (err) {
      reportError("shooter.upcoming-matches-load", err, { shooterId });
    }

    // Resolve registration + squad status for each upcoming match in parallel.
    // For each match: try cached GetMatch (free) → lightweight API query (cheap).
    const statusResults = await Promise.all(
      upcomingRefs.map(async (ref) => {
        const [ct, ...idParts] = ref.split(":");
        if (!ct) return { ref, competitorId: 0, isRegistered: false, isSquadded: false, registrationStarts: null, registrationCloses: null, squaddingStarts: null, squaddingCloses: null, isRegistrationPossible: false, isSquaddingPossible: false };
        const matchId = idParts.join(":");
        const ctNum = parseInt(ct, 10);
        if (isNaN(ctNum)) return { ref, competitorId: 0, isRegistered: false, isSquadded: false, registrationStarts: null, registrationCloses: null, squaddingStarts: null, squaddingCloses: null, isRegistrationPossible: false, isSquaddingPossible: false };

        // Tier 1: check cached GetMatch data (no API call)
        const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id: matchId });
        try {
          const raw = await getMatchDataWithFallback(matchKey);
          if (raw) {
            const entry = JSON.parse(raw) as CacheEntry<RawMatchData>;
            if (entry.data?.event) {
              return resolveShooterStatus(ref, entry.data.event, shooterId);
            }
          }
        } catch { /* fall through to lightweight query */ }

        // Tier 2: lightweight GraphQL query (only IDs + squads, 30min cache)
        try {
          const statusKey = gqlCacheKey("GetUpcomingStatus", { ct: ctNum, id: matchId });
          const { data } = await cachedExecuteQuery<RawUpcomingStatusData>(
            statusKey, UPCOMING_STATUS_QUERY, { ct: ctNum, id: matchId }, UPCOMING_STATUS_TTL,
          );
          if (data.event) {
            return resolveShooterStatus(ref, data.event, shooterId);
          }
        } catch {
          // API error — return unknown status
        }

        return { ref, competitorId: 0, isRegistered: false, isSquadded: false, registrationStarts: null, registrationCloses: null, squaddingStarts: null, squaddingCloses: null, isRegistrationPossible: false, isSquaddingPossible: false };
      }),
    );
    const statusMap = new Map(statusResults.map((s) => [s.ref, s]));

    for (const ref of upcomingRefs) {
      const meta = matchMetaMap.get(ref);
      if (!meta) continue;

      const [ct, ...idParts] = ref.split(":");
      if (!ct) continue;
      const matchId = idParts.join(":");
      const status = statusMap.get(ref);

      // Prefer fresh dates from the status query (API/cache) over the matches
      // domain table, which may have nulls for rows written before migration 0007.
      upcomingMatches.push({
        ct,
        matchId,
        name: meta.name,
        date: meta.date,
        venue: meta.venue,
        level: meta.level,
        division: profile?.division ?? null,
        competitorId: status?.competitorId ?? 0,
        registrationStarts: status?.registrationStarts ?? meta.registrationStarts,
        registrationCloses: status?.registrationCloses ?? meta.registrationCloses,
        isRegistrationPossible: status?.isRegistrationPossible ?? meta.isRegistrationPossible,
        squaddingStarts: status?.squaddingStarts ?? meta.squaddingStarts,
        squaddingCloses: status?.squaddingCloses ?? meta.squaddingCloses,
        isSquaddingPossible: status?.isSquaddingPossible ?? meta.isSquaddingPossible,
        isRegistered: status?.isRegistered ?? false,
        isSquadded: status?.isSquadded ?? false,
      });
    }
  }

  // ── 4. Compute cross-match aggregates ─────────────────────────────────────
  const stats = computeAggregateStats(matchSummaries);

  // ── 5. Evaluate achievements ───────────────────────────────────────────────
  let storedAchievements: import("@/lib/achievements/types").StoredAchievement[] = [];
  try {
    storedAchievements = await db.getShooterAchievements(shooterId);
  } catch (err) {
    reportError("shooter.achievements-load", err, { shooterId });
  }

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
  } catch (err) {
    reportError("shooter.dashboard-cache-write", err, { shooterId });
  }

  console.log(
    JSON.stringify({
      route: "shooter-dashboard",
      shooterId,
      matchCount: totalMatchCount,
      matchesProcessed: matchSummaries.length,
    }),
  );

  usageTelemetry({
    op: "shooter-dashboard-view",
    matchCountBucket: bucketCount(totalMatchCount),
    cacheHit: false,
  });

  return NextResponse.json(response);
}

// ─── DELETE: suppress shooter (GDPR right-to-erasure) ─────────────────────

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shooterId: shooterIdStr } = await params;
  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return NextResponse.json({ error: "Invalid shooterId" }, { status: 400 });
  }

  await db.suppressShooter(shooterId);

  // Invalidate cached dashboard
  try {
    await cache.del(`computed:shooter:${shooterId}:dashboard`);
  } catch (err) {
    reportError("shooter.dashboard-cache-invalidate", err, { shooterId });
  }

  console.log(JSON.stringify({ route: "shooter-suppress", shooterId }));

  return NextResponse.json({ suppressed: true, shooterId });
}
