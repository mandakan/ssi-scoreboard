import { NextResponse } from "next/server";
import { MAX_COMPETITORS } from "@/lib/constants";
import { reportError } from "@/lib/error-telemetry";
import { usageTelemetry } from "@/lib/usage-telemetry";
import { checkRateLimit } from "@/lib/rate-limit";
import { cachedExecuteQuery, gqlCacheKey, SCORECARDS_QUERY, MATCH_QUERY, refreshCachedMatchQuery } from "@/lib/graphql";
import cache from "@/lib/cache-impl";
import { computeMatchFreshness, computeMatchSwrTtl, isMatchComplete } from "@/lib/match-ttl";
import { persistToMatchStore } from "@/lib/match-data-store";
import { isUpstreamDegraded } from "@/lib/upstream-status";
import { afterResponse } from "@/lib/background-impl";

import { extractDivision } from "@/lib/divisions";
import { computeGroupRankings, computeMatchPointTotals, computePenaltyStats, computeCompetitorPPS, computeFieldPPSDistribution, computeConsistencyStats, computeLossBreakdown, simulateWithoutWorstStage, computeStyleFingerprint, computeAllFingerprintPoints, computePercentileRank, assignArchetype, computeStylePercentiles, classifyStageArchetype, computeArchetypePerformance, parseStageConstraints, computeCourseLengthPerformance, computeConstraintPerformance, computeStageDegradationData } from "@/app/api/compare/logic";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { decodeShooterId, indexMatchShooters } from "@/lib/shooter-index";
import type { CompareMode, CompareResponse, CompetitorInfo, FieldFingerprintPoint, StageComparison, StageConditions } from "@/lib/types";
import { fetchMatchWeatherRaw, getHourlySnapshot } from "@/lib/weather";
import { geocodeVenueName } from "@/lib/geocoding";
import { maybeTagAsMcp } from "@/lib/telemetry-context";

interface RawCompetitor {
  id: string;
  get_content_type_key: number;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  get_division_display?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  region?: string | null;
  get_region_display?: string | null;
  category?: string | null;
  ics_alias?: string | null;
  license?: string | null;
  shooter?: { id: string } | null;
}

interface RawMatchData {
  event: {
    starts?: string | null;
    scoring_completed?: string | number | null;
    status?: string | null;
    results?: string | null;
    has_geopos?: boolean | null;
    lat?: number | string | null;
    lng?: number | string | null;
    venue?: string | null;
    region?: string | null;
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
      get_course_display?: string | null;
      procedure?: string | null;
      firearm_condition?: string | null;
    }[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  maybeTagAsMcp(req);
  const rl = await checkRateLimit(req, { prefix: "compare", limit: 30, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

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

  if (competitorIds.length === 0 || competitorIds.length > MAX_COMPETITORS) {
    return NextResponse.json(
      { error: `Between 1 and ${MAX_COMPETITORS} competitor_ids required` },
      { status: 400 }
    );
  }

  const modeParam = searchParams.get("mode");
  const mode: CompareMode = modeParam === "live" ? "live" : "coaching";

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

  // Determine match state and compute TTL
  const scoringPct = parseFloat(
    String(matchData.event?.scoring_completed ?? 0)
  );
  const matchDate = matchData.event?.starts ? new Date(matchData.event.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const signals = {
    status: matchData.event?.status ?? null,
    resultsPublished: matchData.event?.results === "all",
  };
  const isComplete = isMatchComplete(scoringPct, daysSince, signals);
  // SWR-aware TTL — keeps Redis entries alive past the 30s freshness window
  // for live matches so the background refresh below can land before eviction.
  const dataTtl = computeMatchSwrTtl(scoringPct, daysSince, matchData.event?.starts ?? null, signals);

  // Upgrade match cache entry TTL based on match state
  try {
    if (dataTtl === null) {
      const raw = await cache.get(matchKey);
      if (raw) {
        await cache.persist(matchKey); // remove TTL → permanent
        // Persist completed match data to D1/SQLite for durable storage
        afterResponse(persistToMatchStore(matchKey, raw));
      }
    } else if (!matchCachedAt) {
      // Cache miss: correct the initial 30s write TTL
      await cache.expire(matchKey, dataTtl);
    }
  } catch (err) {
    reportError("compare.match-ttl-apply", err, { matchKey });
  }

  // Stale-while-revalidate: schedule a background refresh of the match key
  // when the cached value is older than its freshness window. Single-flight
  // via SETNX so concurrent readers trigger at most one upstream fetch.
  const matchFreshness = computeMatchFreshness(scoringPct, daysSince, matchData.event?.starts ?? null, signals);
  if (matchCachedAt && dataTtl != null && matchFreshness != null) {
    const age = (Date.now() - new Date(matchCachedAt).getTime()) / 1000;
    if (age > matchFreshness) {
      afterResponse(
        refreshCachedMatchQuery<RawMatchData>(
          matchKey,
          MATCH_QUERY,
          { ct: ctNum, id },
          dataTtl,
          { ct: ctNum, id },
        ),
      );
    }
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

  // Upgrade scorecards cache entry TTL based on match state
  try {
    if (dataTtl === null) {
      const raw = await cache.get(scorecardsKey);
      if (raw) {
        await cache.persist(scorecardsKey);
        // Persist completed scorecard data to D1/SQLite for durable storage
        afterResponse(persistToMatchStore(scorecardsKey, raw));
      }
    } else if (!scorecardsCachedAt) {
      await cache.expire(scorecardsKey, dataTtl);
    }
  } catch (err) {
    reportError("compare.scorecards-ttl-apply", err, { matchKey: scorecardsKey });
  }

  // SWR for scorecards (the slowest upstream call) — same single-flight pattern.
  if (scorecardsCachedAt && dataTtl != null && matchFreshness != null) {
    const age = (Date.now() - new Date(scorecardsCachedAt).getTime()) / 1000;
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

  // Start match-global cache read early so the Redis round-trip can resolve
  // during the synchronous computation below (computeGroupRankings, etc.)
  const matchGlobalKey = `computed:matchglobal:${ctNum}:${id}`;
  const matchGlobalCachePromise: Promise<string | null> = mode === "coaching"
    ? cache.get(matchGlobalKey).catch(() => null)
    : Promise.resolve(null);

  let fingerprintCacheHit: boolean | null = null;

  // Report the older of the two cache timestamps (most stale data wins)
  const cacheInfo: CompareResponse["cacheInfo"] = {
    cachedAt: matchCachedAt ?? scorecardsCachedAt,
  };
  if (cacheInfo.cachedAt && (await isUpstreamDegraded())) {
    cacheInfo.upstreamDegraded = true;
  }

  const tFetch = performance.now();

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
      },
    ])
  );

  // Build cross-match shooter index — fire-and-forget, non-fatal.
  // Match metadata (matchMeta) is NOT passed here because the compare route's
  // RawMatchData lacks key fields (name, level, discipline). The match page visit
  // (via match-data.ts) always populates the full matches table entry first.
  indexMatchShooters(ct, id, matchData.event?.starts ?? null, [...competitorInfoMap.values()]);

  const requestedCompetitors: CompetitorInfo[] = competitorIds.map((cid) => {
    return (
      competitorInfoMap.get(cid) ?? {
        id: cid,
        shooterId: null,
        name: `Competitor ${cid}`,
        competitor_number: "",
        club: null,
        division: null,
        region: null,
        region_display: null,
        category: null,
        ics_alias: null,
        license: null,
      }
    );
  });

  // Flatten ALL stage scorecards — not filtered to requested competitors.
  // computeGroupRankings needs the full field to compute division and overall rankings.
  const rawScorecards = parseRawScorecards(scorecardsData);

  // SSI hides per-shot scorecard detail on Level I (club) matches: it returns
  // a non-zero `scoring_completed` but an empty `scorecards` array. Surface
  // that as an explicit flag so the client can render a clear notice instead
  // of a blank comparison table.
  const scorecardsRestricted =
    scoringPct > 0 &&
    rawScorecards.length === 0 &&
    (matchData.event.stages?.length ?? 0) > 0;

  // Surface max(scorecard_created) so the client can show how stale the
  // upstream itself is, independent of our cache age. On an active match
  // this answers "is RO submission falling behind?" — a question that
  // cachedAt cannot answer (a 5s cache age tells you nothing about whether
  // the latest score is from 1 minute or 6 hours ago).
  let lastScorecardTs: string | null = null;
  for (const sc of rawScorecards) {
    if (sc.scorecard_created && (!lastScorecardTs || sc.scorecard_created > lastScorecardTs)) {
      lastScorecardTs = sc.scorecard_created;
    }
  }
  if (lastScorecardTs) cacheInfo.lastScorecardAt = lastScorecardTs;

  const tFlatten = performance.now();

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
        course_display: s.get_course_display ?? null,
        constraints: parseStageConstraints(s.procedure ?? "", s.firearm_condition ?? ""),
      },
    ])
  );

  let stages: StageComparison[] = computeGroupRankings(rawScorecards, requestedCompetitors).map(
    (s) => {
      const meta = stageMetaMap.get(s.stage_id);
      return {
        ...s,
        ...meta,
        stageArchetype: classifyStageArchetype({
          paper_targets: meta?.paper_targets ?? null,
          steel_targets: meta?.steel_targets ?? null,
          min_rounds: meta?.min_rounds ?? null,
          max_points: s.max_points,
          course_display: meta?.course_display ?? null,
        }),
      };
    }
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
        field_median_accuracy: null,
        field_cv: null,
        field_competitor_count: 0,
        stageDifficultyLevel: 3 as const,
        stageDifficultyLabel: "—",
        stageSeparatorLevel: 2 as const,
        stageArchetype: null,
        competitors: {},
        divisionDistributions: {},
        ...(meta ?? {}),
      } satisfies StageComparison;
    });
  }

  const tRankings = performance.now();

  const {
    divisionLeaderMatchPts,
    overallLeaderMatchPts,
    divisionMatchRanks,
    overallMatchRanks,
  } = computeMatchPointTotals(rawScorecards);

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

  // Coaching-only computations — skipped in live mode for faster responses
  let archetypePerformance: CompareResponse["archetypePerformance"] = null;
  let courseLengthPerformance: CompareResponse["courseLengthPerformance"] = null;
  let constraintPerformance: CompareResponse["constraintPerformance"] = null;
  let whatIfStats: CompareResponse["whatIfStats"] = null;
  let fieldFingerprintPoints: CompareResponse["fieldFingerprintPoints"] = null;
  let styleFingerprintStats: CompareResponse["styleFingerprintStats"] = null;
  let stageDegradationData: CompareResponse["stageDegradationData"] = null;
  let stageConditions: CompareResponse["stageConditions"] = null;

  if (mode === "coaching") {
    archetypePerformance = Object.fromEntries(
      requestedCompetitors.map((c) => [c.id, computeArchetypePerformance(stages, c.id)])
    );

    courseLengthPerformance = Object.fromEntries(
      requestedCompetitors.map((c) => [c.id, computeCourseLengthPerformance(stages, c.id)])
    );

    constraintPerformance = Object.fromEntries(
      requestedCompetitors.map((c) => [c.id, computeConstraintPerformance(stages, c.id)])
    );

    whatIfStats = simulateWithoutWorstStage(stages, requestedCompetitors, rawScorecards);
    stageDegradationData = computeStageDegradationData(rawScorecards);

    // Build per-cell conditions overlay (weather + time) — non-fatal, gracefully degrades.
    const ev = matchData.event!;
    let venueLat = ev.has_geopos && ev.lat != null ? parseFloat(String(ev.lat)) : null;
    let venueLng = ev.has_geopos && ev.lng != null ? parseFloat(String(ev.lng)) : null;

    // Fallback: if the SSI event has no GPS coordinates, attempt to geocode the
    // venue name via OpenStreetMap Nominatim (free, cached permanently).
    if ((venueLat == null || venueLng == null) && ev.venue) {
      try {
        const geocoded = await geocodeVenueName(ev.venue, ev.region ?? null);
        if (geocoded) {
          venueLat = geocoded.lat;
          venueLng = geocoded.lng;
        }
      } catch {
        // Non-fatal — fall through without conditions
      }
    }

    if (venueLat != null && venueLng != null) {
      const firstTs = rawScorecards
        .filter((s) => s.scorecard_created != null)
        .map((s) => s.scorecard_created!)
        .sort()[0];
      const conditionsDate = firstTs
        ? firstTs.slice(0, 10)
        : (typeof ev.starts === "string" ? ev.starts.slice(0, 10) : null);
      if (conditionsDate) {
        try {
          const rawWeather = await fetchMatchWeatherRaw(venueLat, venueLng, conditionsDate);
          if (rawWeather) {
            const map: Record<number, Record<number, StageConditions>> = {};
            for (const sc of rawScorecards) {
              if (!sc.scorecard_created || !competitorIds.includes(sc.competitor_id)) continue;
              const t = Date.parse(sc.scorecard_created);
              if (isNaN(t)) continue;
              const hourUtc = new Date(t).getUTCHours();
              const snap = getHourlySnapshot(rawWeather, hourUtc);
              if (!map[sc.stage_id]) map[sc.stage_id] = {};
              map[sc.stage_id][sc.competitor_id] = { hourUtc, ...snap };
            }
            stageConditions = map;
          }
        } catch {
          // Non-fatal — conditions overlay unavailable
        }
      }
    }
  }

  const tPerCompetitor = performance.now();

  if (mode === "coaching") {
    const rawGlobal = await matchGlobalCachePromise;
    let cachedPoints: FieldFingerprintPoint[] | undefined;
    if (rawGlobal) {
      try {
        const parsed = JSON.parse(rawGlobal) as { v?: number; fieldFingerprintPoints?: FieldFingerprintPoint[] };
        if (parsed.v === 1 && Array.isArray(parsed.fieldFingerprintPoints)) {
          cachedPoints = parsed.fieldFingerprintPoints;
        }
      } catch (err) {
        reportError("compare.matchglobal-parse", err, { matchKey: matchGlobalKey });
      }
    }

    let ffp: FieldFingerprintPoint[];
    if (cachedPoints) {
      ffp = cachedPoints;
    } else {
      // Build division map for the full field (used by the fingerprint cohort cloud)
      const divisionMap = new Map<number, string | null>(
        allCompetitors.map((c) => [parseInt(c.id, 10), c.get_handgun_div_display ?? c.handgun_div ?? null])
      );
      ffp = computeAllFingerprintPoints(rawScorecards, divisionMap);
      try {
        const globalPayload = JSON.stringify({ v: 1, fieldFingerprintPoints: ffp });
        await cache.set(matchGlobalKey, globalPayload, dataTtl);
        // Persist matchglobal to D1/SQLite if this is a completed match
        if (dataTtl === null) {
          afterResponse(persistToMatchStore(matchGlobalKey, globalPayload));
        }
      } catch (err) {
        reportError("compare.matchglobal-write", err, { matchKey: matchGlobalKey });
      }
    }

    fingerprintCacheHit = cachedPoints !== undefined;
    fieldFingerprintPoints = ffp;

    const fieldAlphaRatios = ffp.map((p) => p.alphaRatio);
    const fieldSpeeds = ffp.map((p) => p.pointsPerSecond);

    styleFingerprintStats = Object.fromEntries(
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
        const fieldPoint = ffp.find((p) => p.competitorId === c.id);
        const { composurePercentile, consistencyPercentile } =
          computeStylePercentiles(base, fieldPoint?.cv ?? null, ffp);
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
  }

  const tFingerprint = performance.now();
  console.log(JSON.stringify({
    route: "compare",
    ct: ctNum,
    match_id: id,
    competitor_ids: competitorIds,
    competitor_count: competitorIds.length,
    mode,
    match_cache_hit: matchCachedAt !== null,
    scorecards_cache_hit: scorecardsCachedAt !== null,
    fingerprint_cache_hit: fingerprintCacheHit,
    scorecard_count: rawScorecards.length,
    is_complete: isComplete,
    ms_graphql: Math.round(tFetch - t0),
    ms_total: Math.round(tFingerprint - t0),
  }));

  const response: CompareResponse = {
    match_id: parseInt(id, 10),
    mode,
    stages,
    competitors: requestedCompetitors,
    penaltyStats,
    efficiencyStats,
    consistencyStats,
    lossBreakdownStats,
    whatIfStats,
    styleFingerprintStats,
    fieldFingerprintPoints,
    archetypePerformance,
    courseLengthPerformance,
    constraintPerformance,
    stageDegradationData,
    stageConditions,
    ...(scorecardsRestricted ? { scorecardsRestricted: true } : {}),
    divisionLeaderMatchPts,
    overallLeaderMatchPts,
    divisionMatchRanks,
    overallMatchRanks,
    cacheInfo,
  };

  const timingParts = [
    `graphql;dur=${(tFetch - t0).toFixed(1)};desc="GraphQL fetch"`,
    `flatten;dur=${(tFlatten - tFetch).toFixed(1)};desc="Scorecard flatten"`,
    `rankings;dur=${(tRankings - tFlatten).toFixed(1)};desc="Group rankings"`,
    `per-competitor;dur=${(tPerCompetitor - tRankings).toFixed(1)};desc="Per-competitor stats"`,
  ];
  if (mode === "coaching") {
    timingParts.push(`fingerprint;dur=${(tFingerprint - tPerCompetitor).toFixed(1)};desc="${fingerprintCacheHit ? "Fingerprint (cached)" : "Fingerprint (computed)"}"`);
  }
  timingParts.push(`total;dur=${(tFingerprint - t0).toFixed(1)};desc="Total"`);
  const serverTiming = timingParts.join(", ");

  usageTelemetry({
    op: "comparison",
    ct: ctNum,
    mode,
    nCompetitors: requestedCompetitors.length,
  });

  return NextResponse.json(response, {
    headers: { "Server-Timing": serverTiming },
  });
}
