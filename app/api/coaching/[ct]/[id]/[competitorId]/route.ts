import { NextResponse } from "next/server";
import { createAIProvider } from "@/lib/ai-provider";
import { buildCoachingPrompt, buildRoastPrompt, checkCoachingEligibility } from "@/lib/coaching-prompt";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY, SCORECARDS_QUERY } from "@/lib/graphql";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import {
  computeGroupRankings,
  computePenaltyStats,
  computeConsistencyStats,
  computeStyleFingerprint,
  computeAllFingerprintPoints,
  computePercentileRank,
  assignArchetype,
  computeStylePercentiles,
} from "@/app/api/compare/logic";
import { computeMatchTtl } from "@/lib/match-ttl";
import { formatDivisionDisplay } from "@/lib/divisions";
import { decodeShooterId } from "@/lib/shooter-index";
import cache from "@/lib/cache-impl";
import type { CoachingTipResponse, CompetitorInfo } from "@/lib/types";

interface RawCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  shooter?: { id: string } | null;
}

interface RawMatchData {
  event: {
    name?: string | null;
    starts?: string | null;
    scoring_completed?: string | number | null;
    stages?: {
      id: string;
      number: number;
      name: string;
      max_points: number;
    }[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  } | null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ct: string; id: string; competitorId: string }> },
) {
  const { ct, id, competitorId: competitorIdStr } = await params;
  const mode = new URL(req.url).searchParams.get("mode") === "roast" ? "roast" : "coach";

  // 1. Check provider is configured
  const provider = createAIProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "AI coaching is not configured" },
      { status: 503 },
    );
  }

  // 2. Validate params
  const ctNum = parseInt(ct, 10);
  const competitorId = parseInt(competitorIdStr, 10);
  if (isNaN(ctNum) || isNaN(competitorId)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  // 3. Check coaching-specific cache (key includes model + mode for auto-invalidation)
  const coachingCacheKey = `coaching:${mode}:${ct}:${id}:${competitorId}:${provider.modelId}`;
  try {
    const cached = await cache.get(coachingCacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as CoachingTipResponse;
      return NextResponse.json(parsed, {
        headers: { "X-Coaching-Cache": "hit" },
      });
    }
  } catch {
    // Cache miss or error — proceed to generate
  }

  // 4. Fetch match metadata (reuses existing Redis cache)
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let matchData: RawMatchData;
  try {
    ({ data: matchData } = await cachedExecuteQuery<RawMatchData>(
      matchKey,
      MATCH_QUERY,
      { ct: ctNum, id },
      30,
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!matchData.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Determine match state
  const scoringPct = Math.round(
    parseFloat(String(matchData.event.scoring_completed ?? 0)),
  );
  const matchDate = matchData.event.starts
    ? new Date(matchData.event.starts)
    : null;
  const daysSince = matchDate
    ? (Date.now() - matchDate.getTime()) / 86_400_000
    : 0;
  const isComplete = scoringPct >= 95 || daysSince > 3;
  const matchName = matchData.event.name ?? "Unknown Match";

  // 5. Fetch scorecards (reuses existing Redis cache)
  const dataTtl = computeMatchTtl(
    scoringPct,
    daysSince,
    matchData.event.starts ?? null,
  );
  const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
  let scorecardsData: RawScorecardsData;
  try {
    ({ data: scorecardsData } = await cachedExecuteQuery<RawScorecardsData>(
      scorecardsKey,
      SCORECARDS_QUERY,
      { ct: ctNum, id },
      dataTtl,
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!scorecardsData.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Build competitor info
  const allCompetitors =
    matchData.event.competitors_approved_w_wo_results_not_dnf ?? [];
  const rawComp = allCompetitors.find(
    (c) => parseInt(c.id, 10) === competitorId,
  );
  if (!rawComp) {
    return NextResponse.json(
      { error: "Competitor not found in match" },
      { status: 404 },
    );
  }

  const competitorInfo: CompetitorInfo = {
    id: competitorId,
    shooterId: decodeShooterId(rawComp.shooter?.id),
    name:
      [rawComp.first_name, rawComp.last_name].filter(Boolean).join(" ") ||
      "Unknown",
    competitor_number: rawComp.number ?? "",
    club: rawComp.club ?? null,
    division: formatDivisionDisplay(
      rawComp.get_handgun_div_display ?? rawComp.handgun_div,
      rawComp.shoots_handgun_major,
    ),
    region: null,
    region_display: null,
    category: null,
    ics_alias: null,
    license: null,
  };

  // 6. Parse scorecards and compute stage rankings
  const rawScorecards = parseRawScorecards(scorecardsData);
  const stages = computeGroupRankings(rawScorecards, [competitorInfo]);

  // 7. Check eligibility
  const eligibilityError = checkCoachingEligibility(
    scoringPct,
    daysSince,
    stages,
    competitorId,
  );
  if (eligibilityError) {
    return NextResponse.json({ error: eligibilityError }, { status: 422 });
  }

  // 8. Compute stats needed for the prompt
  const penaltyStats = computePenaltyStats(stages, competitorId);
  const consistencyStats = computeConsistencyStats(stages, competitorId);
  const baseFingerprint = computeStyleFingerprint(stages, competitorId);

  // Enrich fingerprint with percentiles for archetype detection
  const divisionMap = new Map<number, string | null>(
    allCompetitors.map((c) => [
      parseInt(c.id, 10),
      c.get_handgun_div_display ?? c.handgun_div ?? null,
    ]),
  );
  const fieldPoints = computeAllFingerprintPoints(rawScorecards, divisionMap);
  const fieldAlphaRatios = fieldPoints.map((p) => p.alphaRatio);
  const fieldSpeeds = fieldPoints.map((p) => p.pointsPerSecond);
  const accuracyPercentile =
    baseFingerprint.alphaRatio != null
      ? computePercentileRank(baseFingerprint.alphaRatio, fieldAlphaRatios)
      : null;
  const speedPercentile =
    baseFingerprint.pointsPerSecond != null
      ? computePercentileRank(baseFingerprint.pointsPerSecond, fieldSpeeds)
      : null;
  const fieldPoint = fieldPoints.find((p) => p.competitorId === competitorId);
  const { composurePercentile, consistencyPercentile } =
    computeStylePercentiles(
      baseFingerprint,
      fieldPoint?.cv ?? null,
      fieldPoints,
    );

  const styleFingerprint = {
    ...baseFingerprint,
    accuracyPercentile,
    speedPercentile,
    archetype: assignArchetype(accuracyPercentile, speedPercentile),
    composurePercentile,
    consistencyPercentile,
  };

  // 9. Build prompt (pure function)
  const promptInput = {
    competitor: competitorInfo,
    stages,
    penaltyStats,
    consistencyStats,
    styleFingerprint,
    matchName,
    fieldSize: fieldPoints.length,
  };
  const prompt =
    mode === "roast"
      ? buildRoastPrompt(promptInput)
      : buildCoachingPrompt(promptInput);

  // 10. Call AI provider
  let tip: string;
  try {
    tip = await provider.generateTip(prompt);
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "AI generation timed out"
        : "AI generation failed";
    console.error(`[coaching] ${msg}:`, err);
    return NextResponse.json({ error: msg }, { status: 504 });
  }

  if (!tip || tip.trim().length === 0) {
    return NextResponse.json(
      { error: "Empty response from AI" },
      { status: 502 },
    );
  }

  // 11. Build response
  const response: CoachingTipResponse = {
    tip: tip.trim(),
    generatedAt: new Date().toISOString(),
    model: provider.modelId,
    competitorId,
    matchId: id,
    ct,
  };

  // 12. Cache the result (permanent for complete matches, 5min for near-complete)
  const cacheTtl = isComplete ? null : 300;
  try {
    if (cacheTtl === null) {
      await cache.set(coachingCacheKey, JSON.stringify(response));
      await cache.persist(coachingCacheKey);
    } else {
      await cache.set(coachingCacheKey, JSON.stringify(response), cacheTtl);
    }
  } catch {
    // Non-fatal — tip still returned to client
  }

  return NextResponse.json(response, {
    headers: { "X-Coaching-Cache": "miss" },
  });
}
