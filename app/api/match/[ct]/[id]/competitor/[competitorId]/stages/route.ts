// /api/match/{ct}/{id}/competitor/{competitorId}/stages
//
// Per-competitor stage results for a single match: time, hit factor, points,
// stage_pct, hit zones, penalties, and DQ flag for every stage. The v1 wrapper
// at app/api/v1/match/[ct]/[id]/competitor/[competitorId]/stages/route.ts is
// the public, bearer-token-gated surface for this data.

import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/background-impl";
import cache from "@/lib/cache-impl";
import { reportError } from "@/lib/error-telemetry";
import { cachedExecuteQuery, gqlCacheKey, refreshCachedMatchQuery, SCORECARDS_QUERY } from "@/lib/graphql";
import { fetchMatchData } from "@/lib/match-data";
import { persistToMatchStore } from "@/lib/match-data-store";
import {
  computeMatchFreshness,
  computeMatchSwrTtl,
  isMatchCompleteFromEvent,
} from "@/lib/match-ttl";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { fetchSelectedCompetitorsScorecards } from "@/lib/scorecards-per-competitor";
import type { RawScorecard } from "@/app/api/compare/logic";
import { maybeTagAsMcp } from "@/lib/telemetry-context";
import { isUpstreamDegraded } from "@/lib/upstream-status";
import { computeGroupRankings } from "@/app/api/compare/logic";
import type {
  CompetitorStageResult,
  CompetitorStageResults,
  CompetitorSummary,
} from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ct: string; id: string; competitorId: string }> },
) {
  maybeTagAsMcp(req);
  const rl = await checkRateLimit(req, { prefix: "competitor-stages", limit: 60, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { ct, id, competitorId: competitorIdStr } = await params;
  const ctNum = parseInt(ct, 10);
  const matchIdNum = parseInt(id, 10);
  const competitorIdNum = parseInt(competitorIdStr, 10);
  if (isNaN(ctNum) || isNaN(matchIdNum) || isNaN(competitorIdNum)) {
    return NextResponse.json(
      { error: "Invalid ct, id, or competitorId" },
      { status: 400 },
    );
  }

  const matchResult = await fetchMatchData(ct, id);
  if (!matchResult) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  const match = matchResult.data;
  const competitor = match.competitors.find((c) => c.id === competitorIdNum);
  if (!competitor) {
    return NextResponse.json(
      { error: "Competitor not found in this match" },
      { status: 404 },
    );
  }

  // Mirror the compare route's TTL machinery for the scorecards key. The match
  // key was already TTL-corrected and SWR-refreshed by `fetchMatchData` above.
  const daysSince = match.date
    ? (Date.now() - new Date(match.date).getTime()) / 86_400_000
    : 0;
  const signals = {
    status: match.match_status,
    resultsPublished: match.results_status === "all",
  };
  const dataTtl = computeMatchSwrTtl(
    match.scoring_completed,
    daysSince,
    match.date,
    signals,
  );

  // Pick the fetch path based on whether the match is complete:
  //  - complete  -> whole-match scorecards (will move to per-stage archive in PR-D)
  //  - live      -> per-competitor scorecards via SSI's `competitor_scorecards()`,
  //                 the SSI-blessed pattern after their 2026-05-04 announcement.
  // During live, whole-field-derived fields like `stage_pct` are not available
  // and surface as null; the UI surfaces this via the gate added in PR-C.
  const isComplete = isMatchCompleteFromEvent({
    scoringPct: match.scoring_completed,
    startDate: match.date,
    status: match.match_status,
    resultsStatus: match.results_status,
  });

  let rawScorecards: RawScorecard[];
  let scorecardsCachedAt: string | null;
  // Map of stage_id → CompetitorSummary (full or partial) for the requested
  // competitor. Whole-field-derived members are null when running the live
  // (per-competitor) path.
  const summaryByStageId = new Map<number, CompetitorSummary>();

  if (isComplete) {
    // Post-match: existing whole-match path.
    const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
    let scorecardsData: RawScorecardsData;
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

    // Promote the scorecards cache TTL to match the resolved match state.
    try {
      if (dataTtl === null) {
        const raw = await cache.get(scorecardsKey);
        if (raw) {
          await cache.persist(scorecardsKey);
          afterResponse(persistToMatchStore(scorecardsKey, raw));
        }
      } else if (!scorecardsCachedAt) {
        await cache.expire(scorecardsKey, dataTtl);
      }
    } catch (err) {
      reportError("competitor-stages.scorecards-ttl-apply", err, {
        matchKey: scorecardsKey,
      });
    }

    // SWR for scorecards — single-flighted inside refreshCachedMatchQuery.
    const matchFreshness = computeMatchFreshness(
      match.scoring_completed,
      daysSince,
      match.date,
      signals,
    );
    if (scorecardsCachedAt && dataTtl != null && matchFreshness != null) {
      const age =
        (Date.now() - new Date(scorecardsCachedAt).getTime()) / 1000;
      if (age > matchFreshness) {
        afterResponse(
          refreshCachedMatchQuery<RawScorecardsData>(
            scorecardsKey,
            SCORECARDS_QUERY,
            { ct: ctNum, id },
            dataTtl,
            { ct: ctNum, id },
          ),
        );
      }
    }

    rawScorecards = parseRawScorecards(scorecardsData);
    const stageComparisons = computeGroupRankings(rawScorecards, [competitor]);
    for (const stage of stageComparisons) {
      const summary = stage.competitors[competitor.id];
      if (summary) summaryByStageId.set(stage.stage_id, summary);
    }
  } else {
    // Live: per-competitor scorecards only. We never pull other shooters'
    // data, so whole-field stats are unavailable and surface as null.
    if (competitor.content_type == null) {
      return NextResponse.json(
        { error: "Competitor metadata missing content_type — refresh the match" },
        { status: 502 },
      );
    }
    const matchStageIds = new Set(match.stages.map((s) => s.id));
    try {
      const result = await fetchSelectedCompetitorsScorecards(
        [
          {
            ct: competitor.content_type,
            id: String(competitor.id),
            numericId: competitor.id,
          },
        ],
        matchStageIds,
        dataTtl,
      );
      rawScorecards = result.scorecards;
      scorecardsCachedAt = result.cachedAts[0] ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upstream error";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Build per-stage summaries from per-competitor data only. Whole-field
    // fields (group/division/overall ranks and percents, classification) stay
    // null until the match is complete.
    const withTimestamps = rawScorecards
      .filter((sc) => sc.scorecard_created)
      .sort((a, b) => a.scorecard_created!.localeCompare(b.scorecard_created!));
    const shootingOrderByStageId = new Map<number, number>();
    withTimestamps.forEach((sc, i) =>
      shootingOrderByStageId.set(sc.stage_id, i + 1),
    );

    for (const sc of rawScorecards) {
      const penaltyLossPoints =
        ((sc.miss_count ?? 0) + (sc.no_shoots ?? 0) + (sc.procedurals ?? 0)) * 10;
      summaryByStageId.set(sc.stage_id, {
        competitor_id: sc.competitor_id,
        points: sc.points,
        hit_factor: sc.hit_factor,
        time: sc.time,
        group_rank: null,
        group_percent: null,
        div_rank: null,
        div_percent: null,
        overall_rank: null,
        overall_percent: null,
        overall_percentile: null,
        dq: sc.dq,
        zeroed: sc.zeroed,
        dnf: sc.dnf,
        incomplete: sc.incomplete,
        a_hits: sc.a_hits,
        c_hits: sc.c_hits,
        d_hits: sc.d_hits,
        miss_count: sc.miss_count,
        no_shoots: sc.no_shoots,
        procedurals: sc.procedurals,
        shooting_order: shootingOrderByStageId.get(sc.stage_id) ?? null,
        divisionKey: sc.competitor_division ?? null,
        stageClassification: null,
        hitLossPoints: null,
        penaltyLossPoints,
        scorecard_created: sc.scorecard_created,
      });
    }
  }

  const sortedMatchStages = [...match.stages].sort(
    (a, b) => a.stage_number - b.stage_number,
  );

  const stages: CompetitorStageResult[] = sortedMatchStages.map((s) => {
    const summary = summaryByStageId.get(s.id);
    if (!summary) {
      return {
        stage_number: s.stage_number,
        stage_id: s.id,
        time_seconds: null,
        scorecard_updated_at: null,
        hit_factor: null,
        stage_points: null,
        stage_pct: null,
        alphas: null,
        charlies: null,
        deltas: null,
        misses: null,
        no_shoots: null,
        procedurals: null,
        dq: false,
      };
    }
    return {
      stage_number: s.stage_number,
      stage_id: s.id,
      time_seconds: summary.time,
      scorecard_updated_at: summary.scorecard_created ?? null,
      hit_factor: summary.hit_factor,
      stage_points: summary.points,
      stage_pct: summary.overall_percent,
      alphas: summary.a_hits,
      charlies: summary.c_hits,
      deltas: summary.d_hits,
      misses: summary.miss_count,
      no_shoots: summary.no_shoots,
      procedurals: summary.procedurals,
      dq: summary.dq,
    };
  });

  // Surface both the match-overview cachedAt and the scorecards cachedAt — the
  // match-overview value alone is misleading during scoring (event.updated does
  // not tick on scorecard saves). Mirrors the contract documented on
  // CacheInfo.scorecardsCachedAt.
  const cacheInfo: CompetitorStageResults["cacheInfo"] = {
    cachedAt: matchResult.cachedAt,
    scorecardsCachedAt,
  };
  if (cacheInfo.cachedAt && (await isUpstreamDegraded())) {
    cacheInfo.upstreamDegraded = true;
  }
  let lastScorecardTs: string | null = null;
  for (const sc of rawScorecards) {
    if (
      sc.scorecard_created &&
      (!lastScorecardTs || sc.scorecard_created > lastScorecardTs)
    ) {
      lastScorecardTs = sc.scorecard_created;
    }
  }
  if (lastScorecardTs) cacheInfo.lastScorecardAt = lastScorecardTs;

  const response: CompetitorStageResults = {
    ct: ctNum,
    matchId: matchIdNum,
    competitorId: competitor.id,
    shooterId: competitor.shooterId,
    division: competitor.division,
    stages,
    cacheInfo,
  };

  return NextResponse.json(response);
}
