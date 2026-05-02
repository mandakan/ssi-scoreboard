import { NextResponse } from "next/server";
import { createAIProvider } from "@/lib/ai-provider";
import {
  buildCoachingPrompt,
  buildRoastPrompt,
  checkCoachingEligibility,
  COACHING_PROMPT_VERSION,
} from "@/lib/coaching-prompt";
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
  computeCourseLengthPerformance,
  computeConstraintPerformance,
  computeStageDegradationData,
  type RawScorecard,
} from "@/app/api/compare/logic";
import { computeMatchTtl, isMatchComplete } from "@/lib/match-ttl";
import { effectiveMatchScoringPct } from "@/lib/match-data";
import { extractDivision } from "@/lib/divisions";
import { decodeShooterId } from "@/lib/shooter-index";
import cache from "@/lib/cache-impl";
import { fetchMatchWeather } from "@/lib/weather";
import type { CoachingTipResponse, CompetitorInfo, MatchWeatherData } from "@/lib/types";

/**
 * Derive temporal context from per-competitor scorecard timestamps.
 * Time-of-day is UTC-derived and approximate (timezone unknown).
 * Also returns UTC start/end hours and the match date for weather fetching.
 */
function deriveTemporalContext(
  rawScorecards: RawScorecard[],
  competitorId: number,
): {
  timeOfDayLabel: string | null;
  sessionDurationHours: number | null;
  matchDate: string | null;       // YYYY-MM-DD (UTC) of first scorecard
  startHourUtc: number | null;    // UTC hour (0–23) of first stage
  endHourUtc: number | null;      // UTC hour (0–23) of last stage
} {
  const timestamps = rawScorecards
    .filter(
      (s) => s.competitor_id === competitorId && s.scorecard_created != null,
    )
    .map((s) => Date.parse(s.scorecard_created!))
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length === 0)
    return {
      timeOfDayLabel: null,
      sessionDurationHours: null,
      matchDate: null,
      startHourUtc: null,
      endHourUtc: null,
    };

  const firstDate = new Date(timestamps[0]);
  const lastDate = new Date(timestamps[timestamps.length - 1]);

  const startHourUtc = firstDate.getUTCHours();
  const endHourUtc = lastDate.getUTCHours();

  // YYYY-MM-DD
  const matchDate = firstDate.toISOString().slice(0, 10);

  let timeOfDayLabel: string;
  if (startHourUtc < 12) timeOfDayLabel = "morning";
  else if (startHourUtc < 14) timeOfDayLabel = "midday";
  else if (startHourUtc < 18) timeOfDayLabel = "afternoon";
  else timeOfDayLabel = "evening";

  const durationMs = timestamps[timestamps.length - 1] - timestamps[0];
  // Only report duration when ≥ 30 minutes (avoids noise from single-stage matches)
  const sessionDurationHours =
    durationMs >= 30 * 60 * 1000 ? durationMs / 3_600_000 : null;

  return { timeOfDayLabel, sessionDurationHours, matchDate, startHourUtc, endHourUtc };
}

/**
 * Compute Stage 1 group_percent minus competitor's match average.
 * Negative = stage 1 below average (possible first-stage nerves).
 */
function computeFirstStageDelta(
  stages: { stage_num: number; competitors: Record<number, { group_percent: number | null } | undefined> }[],
  competitorId: number,
): number | null {
  const sorted = stages.slice().sort((a, b) => a.stage_num - b.stage_num);
  const stage1 = sorted.find((s) => s.stage_num === 1);
  if (!stage1) return null;

  const cs1 = stage1.competitors[competitorId];
  if (cs1?.group_percent == null) return null;

  const percents = sorted
    .map((s) => s.competitors[competitorId]?.group_percent)
    .filter((p): p is number => p != null);

  if (percents.length < 2) return null;

  const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
  return cs1.group_percent - avg;
}

interface RawCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  get_division_display?: string | null;
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
    status?: string | null;
    results?: string | null;
    has_geopos?: boolean | null;
    lat?: number | string | null;
    lng?: number | string | null;
    stages?: {
      id: string;
      number: number;
      name: string;
      max_points: number;
      scoring_completed?: string | number | null;
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

  // 3. Check coaching-specific cache (key includes model + mode + prompt version for auto-invalidation)
  const coachingCacheKey = `coaching:v${COACHING_PROMPT_VERSION}:${mode}:${ct}:${id}:${competitorId}:${provider.modelId}`;
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
  const scoringPct = Math.round(effectiveMatchScoringPct(matchData.event));
  const matchDate = matchData.event.starts
    ? new Date(matchData.event.starts)
    : null;
  const daysSince = matchDate
    ? (Date.now() - matchDate.getTime()) / 86_400_000
    : 0;
  const signals = {
    status: matchData.event.status ?? null,
    resultsPublished: matchData.event.results === "all",
  };
  const isComplete = isMatchComplete(scoringPct, daysSince, signals);
  const matchName = matchData.event.name ?? "Unknown Match";

  // 5. Fetch scorecards (reuses existing Redis cache)
  const dataTtl = computeMatchTtl(
    scoringPct,
    daysSince,
    matchData.event.starts ?? null,
    undefined,
    signals,
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
    division: extractDivision(rawComp),
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
    signals,
  );
  if (eligibilityError) {
    return NextResponse.json({ error: eligibilityError }, { status: 422 });
  }

  // 8. Compute stats needed for the prompt
  const penaltyStats = computePenaltyStats(stages, competitorId);
  const consistencyStats = computeConsistencyStats(stages, competitorId);
  const baseFingerprint = computeStyleFingerprint(stages, competitorId);
  const courseLengthPerformance = computeCourseLengthPerformance(stages, competitorId);
  const constraintPerformance = computeConstraintPerformance(stages, competitorId);
  const stageDegradationData = computeStageDegradationData(rawScorecards);
  const firstStageDelta = computeFirstStageDelta(stages, competitorId);
  const {
    timeOfDayLabel,
    sessionDurationHours,
    matchDate: scorecardsDate,
    startHourUtc,
    endHourUtc,
  } = deriveTemporalContext(rawScorecards, competitorId);

  // Fetch weather — non-fatal, gracefully degrades to null if coordinates unavailable,
  // API unreachable, or match date is too recent for the archive API.
  const ev = matchData.event!;
  const lat =
    ev.has_geopos && ev.lat != null ? parseFloat(String(ev.lat)) : null;
  const lng =
    ev.has_geopos && ev.lng != null ? parseFloat(String(ev.lng)) : null;
  const startsDate = typeof ev.starts === "string" ? ev.starts.slice(0, 10) : null;
  const weatherDate = scorecardsDate ?? startsDate ?? null;

  let weatherContext: MatchWeatherData | null = null;
  if (lat != null && lng != null && weatherDate != null) {
    weatherContext = await fetchMatchWeather(
      lat,
      lng,
      weatherDate,
      startHourUtc,
      endHourUtc,
    );
  }

  // Enrich fingerprint with percentiles for archetype detection
  const divisionMap = new Map<number, string | null>(
    allCompetitors.map((c) => [
      parseInt(c.id, 10),
      c.get_division_display || c.get_handgun_div_display || c.handgun_div || null,
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
    stageDegradationData,
    courseLengthPerformance,
    constraintPerformance,
    firstStageDelta,
    timeOfDayLabel,
    sessionDurationHours,
    weatherContext,
  };
  const prompt =
    mode === "roast"
      ? buildRoastPrompt(promptInput)
      : buildCoachingPrompt(promptInput);

  // 10. Call AI provider
  let tip: string;
  try {
    tip = await provider.generateTip(prompt, 200);
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
