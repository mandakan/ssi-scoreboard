import { NextResponse } from "next/server";
import { cachedExecuteQuery, gqlCacheKey, SCORECARDS_QUERY, MATCH_QUERY } from "@/lib/graphql";
import cache from "@/lib/cache-impl";

export const runtime = "edge";
import { formatDivisionDisplay } from "@/lib/divisions";
import { computeGroupRankings, computePenaltyStats, computeCompetitorPPS, computeFieldPPSDistribution, computeConsistencyStats, computeLossBreakdown, simulateWithoutWorstStage, computeStyleFingerprint, computeAllFingerprintPoints, computePercentileRank, assignArchetype, computeStylePercentiles, type RawScorecard } from "@/app/api/compare/logic";
import type { CompareResponse, CompetitorInfo, StageComparison } from "@/lib/types";

// ─── Raw GraphQL response shapes ─────────────────────────────────────────────

interface RawScCard {
  created?: string | null;
  points?: number | string | null;
  hitfactor?: number | string | null;
  time?: number | string | null;
  disqualified?: boolean | null;
  zeroed?: boolean | null;
  stage_not_fired?: boolean | null;
  incomplete?: boolean | null;
  ascore?: number | string | null;
  bscore?: number | string | null;
  cscore?: number | string | null;
  dscore?: number | string | null;
  miss?: number | string | null;
  penalty?: number | string | null;
  procedural?: number | string | null;
  competitor?: {
    id: string;
    first_name?: string;
    last_name?: string;
    number?: string;
    club?: string | null;
    handgun_div?: string | null;
    get_handgun_div_display?: string | null;
  } | null;
}

interface RawStage {
  id: string;
  number: number;
  name: string;
  max_points?: number | null; // from ... on IpscStageNode fragment
  scorecards?: RawScCard[];
}

interface RawScorecardsData {
  event: {
    stages?: RawStage[];
  } | null;
}

interface RawCompetitor {
  id: string;
  get_content_type_key: number;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
}

interface RawMatchData {
  event: {
    starts?: string | null;
    scoring_completed?: string | number | null;
    stages?: {
      id: string;
      number: number;
      name: string;
      max_points: number;
      minimum_rounds?: number | null;
      paper?: number | null;
      popper?: number | null;
      plate?: number | null;
      get_full_absolute_url?: string | null;
    }[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const t0 = performance.now();

  const { searchParams } = new URL(req.url);
  const ct = searchParams.get("ct");
  const id = searchParams.get("id");
  const idsParam = searchParams.get("competitor_ids");

  if (!ct || !id || !idsParam) {
    return NextResponse.json(
      { error: "Required params: ct, id, competitor_ids" },
      { status: 400 }
    );
  }

  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  const competitorIds = idsParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  if (competitorIds.length === 0 || competitorIds.length > 10) {
    return NextResponse.json(
      { error: "Between 1 and 10 competitor_ids required" },
      { status: 400 }
    );
  }

  // Step 1 — fetch match metadata to determine TTL for scorecards
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let matchData: RawMatchData;
  let matchCachedAt: string | null;
  try {
    ({ data: matchData, cachedAt: matchCachedAt } =
      await cachedExecuteQuery<RawMatchData>(matchKey, MATCH_QUERY, { ct: ctNum, id }, 30));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Determine match completion state to set appropriate TTL
  const scoringPct = Math.round(
    parseFloat(String(matchData.event?.scoring_completed ?? 0))
  );
  const matchDate = matchData.event?.starts ? new Date(matchData.event.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const isComplete = scoringPct >= 95 || daysSince > 3;
  const dataTtl: number | null = isComplete ? null : 30;

  // Upgrade match cache entry to permanent if match is now complete
  if (isComplete) {
    try {
      const raw = await cache.get(matchKey);
      if (raw) await cache.persist(matchKey); // remove TTL → permanent
    } catch { /* ignore */ }
  }

  // Step 2 — fetch scorecards with TTL determined by match state
  const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
  let scorecardsData: RawScorecardsData;
  let scorecardsCachedAt: string | null;
  try {
    ({ data: scorecardsData, cachedAt: scorecardsCachedAt } =
      await cachedExecuteQuery<RawScorecardsData>(
        scorecardsKey,
        SCORECARDS_QUERY,
        { ct: ctNum, id },
        dataTtl,
      ));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Report the older of the two cache timestamps (most stale data wins)
  const cacheInfo = { cachedAt: matchCachedAt ?? scorecardsCachedAt };

  const tFetch = performance.now();
  console.log(`[compare] graphql fetch: ${(tFetch - t0).toFixed(0)}ms`);

  if (!scorecardsData.event || !matchData.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Build competitor info map from match data
  const allCompetitors = matchData.event.competitors_approved_w_wo_results_not_dnf ?? [];
  const competitorInfoMap = new Map<number, CompetitorInfo>(
    allCompetitors.map((c) => [
      parseInt(c.id, 10),
      {
        id: parseInt(c.id, 10),
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
        competitor_number: c.number ?? "",
        club: c.club ?? null,
        division: formatDivisionDisplay(c.get_handgun_div_display ?? c.handgun_div, c.shoots_handgun_major),
      },
    ])
  );

  const requestedCompetitors: CompetitorInfo[] = competitorIds.map((cid) => {
    return (
      competitorInfoMap.get(cid) ?? {
        id: cid,
        name: `Competitor ${cid}`,
        competitor_number: "",
        club: null,
        division: null,
      }
    );
  });

  // Flatten ALL stage scorecards — not filtered to requested competitors.
  // computeGroupRankings needs the full field to compute division and overall rankings.
  const rawScorecards: RawScorecard[] = [];

  for (const stage of scorecardsData.event.stages ?? []) {
    const stageId = parseInt(stage.id, 10);

    for (const sc of stage.scorecards ?? []) {
      if (!sc.competitor) continue;
      const compId = parseInt(sc.competitor.id, 10);

      const parseNum = (v: number | string | null | undefined) =>
        v != null ? parseFloat(String(v)) : null;

      const b = parseNum(sc.bscore);
      const c = parseNum(sc.cscore);
      rawScorecards.push({
        competitor_id: compId,
        competitor_division: sc.competitor.get_handgun_div_display ?? sc.competitor.handgun_div ?? null,
        stage_id: stageId,
        stage_number: stage.number,
        stage_name: stage.name,
        max_points: stage.max_points ?? 0,
        points: parseNum(sc.points),
        hit_factor: parseNum(sc.hitfactor),
        time: parseNum(sc.time),
        dq: sc.disqualified ?? false,
        zeroed: sc.zeroed ?? false,
        dnf: sc.stage_not_fired ?? false,
        incomplete: sc.incomplete ?? false,
        a_hits: parseNum(sc.ascore),
        c_hits: b !== null || c !== null ? (b ?? 0) + (c ?? 0) : null,
        d_hits: parseNum(sc.dscore),
        miss_count: parseNum(sc.miss),
        no_shoots: parseNum(sc.penalty),
        procedurals: parseNum(sc.procedural),
        scorecard_created: sc.created ?? null,
      });
    }
  }

  const tFlatten = performance.now();
  console.log(`[compare] scorecard flatten (${rawScorecards.length} records): ${(tFlatten - tFetch).toFixed(0)}ms`);

  // Build a map of stage_id → stage metadata from match data
  const stageMetaMap = new Map(
    (matchData.event.stages ?? []).map((s) => [
      parseInt(s.id, 10),
      {
        ssi_url: s.get_full_absolute_url ? `https://${s.get_full_absolute_url}` : null,
        min_rounds: s.minimum_rounds ?? null,
        paper_targets: s.paper ?? null,
        steel_targets: (s.popper != null || s.plate != null)
          ? (s.popper ?? 0) + (s.plate ?? 0)
          : null,
      },
    ])
  );

  let stages: StageComparison[] = computeGroupRankings(rawScorecards, requestedCompetitors).map(
    (s) => ({ ...s, ...stageMetaMap.get(s.stage_id) })
  );

  // Fallback for future matches: if no scorecards exist yet but stage metadata is
  // available from the match query, build placeholder rows so the comparison table
  // shows stage names and metadata. Competitor cells render "—" for undefined entries.
  if (stages.length === 0 && stageMetaMap.size > 0) {
    stages = (matchData.event.stages ?? []).map((s) => {
      const stageId = parseInt(s.id, 10);
      const meta = stageMetaMap.get(stageId);
      return {
        stage_id: stageId,
        stage_name: s.name,
        stage_num: s.number,
        max_points: s.max_points ?? 0,
        group_leader_hf: null,
        group_leader_points: null,
        overall_leader_hf: null,
        field_median_hf: null,
        field_competitor_count: 0,
        stageDifficultyLevel: 3 as const,
        stageDifficultyLabel: "—",
        competitors: {},
        ...(meta ?? {}),
      } satisfies StageComparison;
    });
  }

  const tRankings = performance.now();
  console.log(`[compare] computeGroupRankings: ${(tRankings - tFlatten).toFixed(0)}ms`);

  const penaltyStats = Object.fromEntries(
    requestedCompetitors.map((c) => [c.id, computePenaltyStats(stages, c.id)])
  );

  const fieldPPS = computeFieldPPSDistribution(rawScorecards);
  const efficiencyStats = Object.fromEntries(
    requestedCompetitors.map((c) => [
      c.id,
      {
        pointsPerShot: computeCompetitorPPS(stages, c.id),
        ...fieldPPS,
      },
    ])
  );

  const consistencyStats = Object.fromEntries(
    requestedCompetitors.map((c) => [c.id, computeConsistencyStats(stages, c.id)])
  );

  const lossBreakdownStats = Object.fromEntries(
    requestedCompetitors.map((c) => [c.id, computeLossBreakdown(stages, c.id)])
  );

  const whatIfStats = simulateWithoutWorstStage(stages, requestedCompetitors, rawScorecards);

  const tPerCompetitor = performance.now();
  console.log(`[compare] per-competitor stats: ${(tPerCompetitor - tRankings).toFixed(0)}ms`);

  // Build division map for the full field (used by the fingerprint cohort cloud)
  const divisionMap = new Map<number, string | null>(
    allCompetitors.map((c) => [parseInt(c.id, 10), c.get_handgun_div_display ?? c.handgun_div ?? null])
  );
  // fieldFingerprintPoints includes percentile ranks so we compute it before enriching
  // the selected competitors' stats.
  const fieldFingerprintPoints = computeAllFingerprintPoints(rawScorecards, divisionMap);

  const fieldAlphaRatios = fieldFingerprintPoints.map((p) => p.alphaRatio);
  const fieldSpeeds = fieldFingerprintPoints.map((p) => p.pointsPerSecond);

  const styleFingerprintStats = Object.fromEntries(
    requestedCompetitors.map((c) => {
      const base = computeStyleFingerprint(stages, c.id);
      const accuracyPercentile =
        base.alphaRatio != null
          ? computePercentileRank(base.alphaRatio, fieldAlphaRatios)
          : null;
      const speedPercentile =
        base.pointsPerSecond != null
          ? computePercentileRank(base.pointsPerSecond, fieldSpeeds)
          : null;
      const fieldPoint = fieldFingerprintPoints.find((p) => p.competitorId === c.id);
      const { composurePercentile, consistencyPercentile } =
        computeStylePercentiles(base, fieldPoint?.cv ?? null, fieldFingerprintPoints);
      return [
        c.id,
        {
          ...base,
          accuracyPercentile,
          speedPercentile,
          archetype: assignArchetype(accuracyPercentile, speedPercentile),
          composurePercentile,
          consistencyPercentile,
        },
      ];
    })
  );

  const tFingerprint = performance.now();
  console.log(`[compare] fingerprint (${fieldFingerprintPoints.length} field pts): ${(tFingerprint - tPerCompetitor).toFixed(0)}ms`);
  console.log(`[compare] total: ${(tFingerprint - t0).toFixed(0)}ms`);

  const response: CompareResponse = {
    match_id: parseInt(id, 10),
    stages,
    competitors: requestedCompetitors,
    penaltyStats,
    efficiencyStats,
    consistencyStats,
    lossBreakdownStats,
    whatIfStats,
    styleFingerprintStats,
    fieldFingerprintPoints,
    cacheInfo,
  };

  const serverTiming = [
    `graphql;dur=${(tFetch - t0).toFixed(1)};desc="GraphQL fetch"`,
    `flatten;dur=${(tFlatten - tFetch).toFixed(1)};desc="Scorecard flatten"`,
    `rankings;dur=${(tRankings - tFlatten).toFixed(1)};desc="Group rankings"`,
    `per-competitor;dur=${(tPerCompetitor - tRankings).toFixed(1)};desc="Per-competitor stats"`,
    `fingerprint;dur=${(tFingerprint - tPerCompetitor).toFixed(1)};desc="Fingerprint"`,
    `total;dur=${(tFingerprint - t0).toFixed(1)};desc="Total"`,
  ].join(", ");

  return NextResponse.json(response, {
    headers: { "Server-Timing": serverTiming },
  });
}
