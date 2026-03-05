// Admin-only endpoint: full match results for all competitors.
// Optimized for DataFrame/DuckDB loading in the data science lab.
// Auth: Authorization: Bearer <CACHE_PURGE_SECRET>
// Read-only — never triggers GraphQL calls.

import { NextResponse, type NextRequest } from "next/server";
import { getMatchDataWithFallback } from "@/lib/match-data-store";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { computeFullFieldRankings } from "@/app/api/compare/logic";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { decodeShooterId } from "@/lib/shooter-index";

interface RawMatchData {
  event: {
    name: string;
    starts: string | null;
    level?: string | null;
    region?: string | null;
    scoring_completed?: string | number | null;
    stages?: Array<{
      id: string;
      number: number;
      name: string;
      max_points?: number | null;
    }>;
    competitors_approved_w_wo_results_not_dnf?: Array<{
      id: string;
      first_name?: string;
      last_name?: string;
      club?: string | null;
      handgun_div?: string | null;
      get_handgun_div_display?: string | null;
      shooter?: { id: string } | null;
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

  // Load match metadata (read-only, no GraphQL)
  const matchKey = `gql:GetMatch:${JSON.stringify({ ct: ctNum, id })}`;
  const matchRaw = await getMatchDataWithFallback(matchKey);
  if (!matchRaw) {
    return NextResponse.json({ error: "Match not found in cache" }, { status: 404 });
  }

  const matchParsed = JSON.parse(matchRaw) as { v?: number; data?: RawMatchData };
  if (matchParsed.v !== CACHE_SCHEMA_VERSION || !matchParsed.data?.event) {
    return NextResponse.json({ error: "Match data has outdated schema" }, { status: 404 });
  }

  // Load scorecards (read-only, no GraphQL)
  const scKey = `gql:GetMatchScorecards:${JSON.stringify({ ct: ctNum, id })}`;
  const scRaw = await getMatchDataWithFallback(scKey);
  if (!scRaw) {
    return NextResponse.json({ error: "Scorecards not found in cache" }, { status: 404 });
  }

  const scParsed = JSON.parse(scRaw) as { v?: number; data?: RawScorecardsData };
  if (scParsed.v !== CACHE_SCHEMA_VERSION || !scParsed.data) {
    return NextResponse.json({ error: "Scorecard data has outdated schema" }, { status: 404 });
  }

  const ev = matchParsed.data.event;
  const rawScorecards = parseRawScorecards(scParsed.data);

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
    division: c.get_handgun_div_display ?? c.handgun_div ?? null,
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
      scoringCompleted: Math.round(parseFloat(String(ev.scoring_completed ?? 0))),
    },
    stages,
    competitors,
    results,
  });
}
