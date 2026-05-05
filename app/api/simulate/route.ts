import { NextResponse } from "next/server";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY } from "@/lib/graphql";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { cachedWholeMatchArchive } from "@/lib/scorecards-archive";
import { applyAdjustmentsToScorecards } from "@/lib/simulate-apply";
import { effectiveMatchScoringPct } from "@/lib/match-data";
import { isMatchCompleteFromEvent } from "@/lib/match-ttl";
import type { WhatIfSimulationRequest, WhatIfSimulationResponse } from "@/lib/types";

// Shape returned when the route is invoked on a live (not-yet-complete) match.
// Per #410 the route's whole-match computation is gated until completion. UI
// callers should branch on `available` and render the empty-state when false.
interface NotAvailableResponse {
  available: false;
  reason: "match-not-complete";
}

// Minimal shape used to evaluate match completeness and feed the per-stage
// archival fan-out without pulling scorecards.
interface MatchEventForGate {
  event: {
    starts?: string | null;
    status?: string | null;
    results?: string | null;
    scoring_completed?: string | number | null;
    stages?: Array<{ id: string; scoring_completed?: string | number | null }>;
  } | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function rankByMatchPct(pctMap: Map<number, number>): Map<number, number> {
  const sorted = [...pctMap.entries()].sort((a, b) => b[1] - a[1]);
  const rankMap = new Map<number, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1] < sorted[i - 1][1]) currentRank = i + 1;
    rankMap.set(sorted[i][0], currentRank);
  }
  return rankMap;
}

// ─── POST /api/simulate ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    ct,
    id,
    competitorId,
    adjustments,
  } = body as Partial<WhatIfSimulationRequest>;

  if (
    typeof ct !== "string" || !ct ||
    typeof id !== "string" || !id ||
    typeof competitorId !== "number" ||
    typeof adjustments !== "object" || adjustments == null
  ) {
    return NextResponse.json(
      { error: "Required fields: ct (string), id (string), competitorId (number), adjustments (object)" },
      { status: 400 }
    );
  }

  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  // Gate on match completion before pulling scorecards. The simulator
  // computes ranks across the whole field, which is unavailable during the
  // live per-competitor data path (#410). Match metadata is small and almost
  // always cache-hit, so this adds negligible latency for live requests
  // while saving the heavy whole-match scorecards fetch.
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let matchData: MatchEventForGate;
  try {
    ({ data: matchData } = await cachedExecuteQuery<MatchEventForGate>(
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
  const isComplete = isMatchCompleteFromEvent({
    scoringPct: effectiveMatchScoringPct(matchData.event),
    startDate: matchData.event.starts ?? null,
    status: matchData.event.status,
    resultsStatus: matchData.event.results,
  });
  if (!isComplete) {
    const payload: NotAvailableResponse = {
      available: false,
      reason: "match-not-complete",
    };
    return NextResponse.json(payload);
  }

  // Fetch scorecards via per-stage archival fan-out (#410). Gated above on
  // isComplete; cache key matches the legacy SCORECARDS_QUERY layout so it
  // hits the same Redis/D1 entries the compare route warms (and vice versa).
  const stageRefs = (matchData.event.stages ?? []).map((s) => ({
    ct: 24,
    id: s.id,
  }));
  let scorecardsData: RawScorecardsData;
  try {
    ({ data: scorecardsData } = await cachedWholeMatchArchive(ctNum, id, stageRefs));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!scorecardsData.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const rawScorecards = parseRawScorecards(scorecardsData);

  // Find the competitor's division from scorecards (uses get_handgun_div_display)
  const competitorScorecard = rawScorecards.find(
    (sc) => sc.competitor_id === competitorId
  );
  if (!competitorScorecard) {
    return NextResponse.json({ error: "Competitor not found in match" }, { status: 404 });
  }
  const competitorDivision = competitorScorecard.competitor_division;

  // Apply adjustments — only the simulated competitor's scorecards change
  const modifiedScorecards = applyAdjustmentsToScorecards(
    rawScorecards,
    competitorId,
    competitorDivision,
    adjustments as Record<number, import("@/lib/types").StageSimulatorAdjustments>
  );

  // Compute per-stage leaders from modified scorecards
  type StageAccum = { maxOverallHF: number; byDiv: Map<string, number> };
  const stageAccum = new Map<number, StageAccum>();
  for (const sc of modifiedScorecards) {
    if (sc.dnf || sc.dq || sc.zeroed) continue;
    const hf = sc.hit_factor;
    if (hf == null || hf <= 0) continue;

    const acc = stageAccum.get(sc.stage_id) ?? { maxOverallHF: 0, byDiv: new Map() };
    if (hf > acc.maxOverallHF) acc.maxOverallHF = hf;
    const divKey = sc.competitor_division ?? "__none__";
    if (hf > (acc.byDiv.get(divKey) ?? 0)) acc.byDiv.set(divKey, hf);
    stageAccum.set(sc.stage_id, acc);
  }

  // Compute match-level avg div% and overall% for every competitor
  type MatchPctAccum = { divSum: number; divCount: number; overallSum: number; overallCount: number; divKey: string };
  const compMatchPct = new Map<number, MatchPctAccum>();

  for (const sc of modifiedScorecards) {
    if (sc.dnf || sc.dq || sc.zeroed) continue;
    const hf = sc.hit_factor;
    if (hf == null || hf <= 0) continue;

    const acc = stageAccum.get(sc.stage_id);
    if (!acc) continue;

    const divKey = sc.competitor_division ?? "__none__";
    const existing = compMatchPct.get(sc.competitor_id) ?? {
      divSum: 0, divCount: 0, overallSum: 0, overallCount: 0, divKey,
    };

    if (acc.maxOverallHF > 0) {
      existing.overallSum += (hf / acc.maxOverallHF) * 100;
      existing.overallCount++;
    }
    const divLeaderHF = acc.byDiv.get(divKey) ?? null;
    if (divLeaderHF && divLeaderHF > 0) {
      existing.divSum += (hf / divLeaderHF) * 100;
      existing.divCount++;
    }
    compMatchPct.set(sc.competitor_id, existing);
  }

  // Aggregate to match-level avg%
  const allDivMatchPcts = new Map<number, number>();
  const allOverallMatchPcts = new Map<number, number>();
  const compDivKeyMap = new Map<number, string>();
  for (const [compId, data] of compMatchPct) {
    if (data.divCount > 0) {
      allDivMatchPcts.set(compId, data.divSum / data.divCount);
      compDivKeyMap.set(compId, data.divKey);
    }
    if (data.overallCount > 0) {
      allOverallMatchPcts.set(compId, data.overallSum / data.overallCount);
    }
  }

  // Group div%s by division for ranking
  const divGroupPcts = new Map<string, Map<number, number>>();
  for (const [compId, avgPct] of allDivMatchPcts) {
    const divKey = compDivKeyMap.get(compId)!;
    const divMap = divGroupPcts.get(divKey) ?? new Map<number, number>();
    divMap.set(compId, avgPct);
    divGroupPcts.set(divKey, divMap);
  }

  // Compute div ranks per division
  const allDivRanks = new Map<number, number>();
  for (const [, divPcts] of divGroupPcts) {
    const ranked = rankByMatchPct(divPcts);
    for (const [compId, rank] of ranked) allDivRanks.set(compId, rank);
  }
  const allOverallRanks = rankByMatchPct(allOverallMatchPcts);

  const newMatchAvgDivPercent = allDivMatchPcts.get(competitorId) ?? null;
  const newMatchAvgOverallPercent = allOverallMatchPcts.get(competitorId) ?? null;
  const newDivRank = allDivRanks.get(competitorId) ?? null;
  const newOverallRank = allOverallRanks.get(competitorId) ?? null;

  const response: WhatIfSimulationResponse = {
    newMatchAvgDivPercent,
    newMatchAvgOverallPercent,
    newDivRank,
    newOverallRank,
  };

  return NextResponse.json(response);
}
