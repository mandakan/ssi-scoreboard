// Admin-only endpoint: full match results for all competitors.
// Optimized for DataFrame/DuckDB loading in the data science lab.
// Auth: Authorization: Bearer <CACHE_PURGE_SECRET>
// Uses cachedExecuteQuery — stale/missing cache entries are auto-refreshed from GraphQL.

import { NextResponse, type NextRequest } from "next/server";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY, SCORECARDS_QUERY } from "@/lib/graphql";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { computeFullFieldRankings } from "@/app/api/compare/logic";
import { decodeShooterId } from "@/lib/shooter-index";
import { effectiveMatchScoringPct } from "@/lib/match-data";
import { isMatchCompleteFromEvent } from "@/lib/match-ttl";

interface RawMatchData {
  event: {
    name: string;
    starts: string | null;
    status?: string | null;
    results?: string | null;
    level?: string | null;
    region?: string | null;
    get_full_rule_display?: string | null;
    scoring_completed?: string | number | null;
    stages?: Array<{
      id: string;
      number: number;
      name: string;
      max_points?: number | null;
      scoring_completed?: string | number | null;
    }>;
    competitors_approved_w_wo_results_not_dnf?: Array<{
      id: string;
      first_name?: string;
      last_name?: string;
      club?: string | null;
      get_division_display?: string | null;
      handgun_div?: string | null;
      get_handgun_div_display?: string | null;
      shooter?: { id: string } | null;
      region?: string | null;
      get_region_display?: string | null;
      category?: string | null;
      ics_alias?: string | null;
    }>;
  } | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ct: string; id: string }> },
) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ct, id } = await params;
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum) || !id) {
    return NextResponse.json({ error: "Invalid ct or id" }, { status: 400 });
  }

  // Load match metadata — auto-refreshes stale/missing entries from GraphQL
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let matchData: RawMatchData;
  try {
    ({ data: matchData } = await cachedExecuteQuery<RawMatchData>(matchKey, MATCH_QUERY, { ct: ctNum, id }, null));
  } catch {
    return NextResponse.json({ error: "Failed to fetch match data" }, { status: 502 });
  }

  if (!matchData.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Gate before pulling scorecards. The admin/data-lab full-field rankings
  // endpoint requires whole-match data; per #410 we no longer fetch that
  // during live (the per-competitor live path covers selected competitors
  // only). Match metadata is small and almost always cache-hit, so this is
  // a cheap pre-check that saves the heavy scorecards fetch on live calls.
  const isComplete = isMatchCompleteFromEvent({
    scoringPct: effectiveMatchScoringPct(matchData.event),
    startDate: matchData.event.starts ?? null,
    status: matchData.event.status,
    resultsStatus: matchData.event.results,
  });
  if (!isComplete) {
    return NextResponse.json({
      available: false,
      reason: "match-not-complete" as const,
    });
  }

  // Load scorecards — auto-refreshes stale/missing entries from GraphQL
  const scKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
  let scorecardsData: RawScorecardsData;
  try {
    ({ data: scorecardsData } = await cachedExecuteQuery<RawScorecardsData>(scKey, SCORECARDS_QUERY, { ct: ctNum, id }, null));
  } catch {
    return NextResponse.json({ error: "Failed to fetch scorecards" }, { status: 502 });
  }

  const ev = matchData.event;
  const rawScorecards = parseRawScorecards(scorecardsData);

  if (rawScorecards.length === 0) {
    return NextResponse.json({ error: "No scorecard data available" }, { status: 404 });
  }

  // Compute full-field rankings for all competitors on all stages
  const fullResults = computeFullFieldRankings(rawScorecards);

  // Build competitor metadata from match data
  const competitors = (ev.competitors_approved_w_wo_results_not_dnf ?? []).map((c) => ({
    competitorId: parseInt(c.id, 10),
    shooterId: decodeShooterId(c.shooter?.id) ?? null,
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
    club: c.club ?? null,
    division: c.get_division_display || c.get_handgun_div_display || c.handgun_div || null,
    region: c.region ?? null,
    regionDisplay: c.get_region_display ?? null,
    category: c.category ?? null,
    icsAlias: c.ics_alias ?? null,
  }));

  // Build stage metadata
  const stages = (ev.stages ?? []).map((s) => ({
    stageId: parseInt(s.id, 10),
    stageNumber: s.number,
    stageName: s.name,
    maxPoints: s.max_points ?? 0,
  }));

  // Map results to flat output format
  const results = fullResults.map((r) => ({
    competitorId: r.competitorId,
    stageId: r.stageId,
    hitFactor: r.hitFactor,
    points: r.points,
    time: r.time,
    maxPoints: r.maxPoints,
    aHits: r.aHits,
    cHits: r.cHits,
    dHits: r.dHits,
    missCount: r.missCount,
    noShoots: r.noShoots,
    procedurals: r.procedurals,
    dq: r.dq,
    dnf: r.dnf,
    zeroed: r.zeroed,
    overallRank: r.overallRank,
    overallPercent: r.overallPercent != null ? Math.round(r.overallPercent * 10) / 10 : null,
    divisionRank: r.divisionRank,
    divisionPercent: r.divisionPercent != null ? Math.round(r.divisionPercent * 10) / 10 : null,
  }));

  return NextResponse.json({
    meta: {
      ct: ctNum,
      matchId: id,
      name: ev.name,
      date: ev.starts ?? null,
      level: ev.level ?? null,
      region: ev.region ?? null,
      discipline: ev.get_full_rule_display ?? null,
      scoringCompleted: Math.round(effectiveMatchScoringPct(ev)),
    },
    stages,
    competitors,
    results,
  });
}
