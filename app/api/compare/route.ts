import { NextResponse } from "next/server";
import { executeQuery, SCORECARDS_QUERY, MATCH_QUERY } from "@/lib/graphql";
import { computeGroupRankings, type RawScorecard } from "@/app/api/compare/logic";
import type { CompareResponse, CompetitorInfo } from "@/lib/types";

// ─── Raw GraphQL response shapes ─────────────────────────────────────────────

interface RawScCard {
  points?: number | string | null;
  hitfactor?: number | string | null;
  time?: number | string | null;
  disqualified?: boolean | null;
  zeroed?: boolean | null;
  stage_not_fired?: boolean | null;
  competitor?: {
    id: string;
    first_name?: string;
    last_name?: string;
    number?: string;
    club?: string | null;
    handgun_div?: string | null;
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
}

interface RawMatchData {
  event: {
    stages?: { id: string; number: number; name: string; max_points: number }[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
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

  // Fetch match scorecards and competitor metadata in parallel
  let scorecardsData: RawScorecardsData;
  let matchData: RawMatchData;

  try {
    [scorecardsData, matchData] = await Promise.all([
      executeQuery<RawScorecardsData>(SCORECARDS_QUERY, { ct: ctNum, id }),
      executeQuery<RawMatchData>(MATCH_QUERY, { ct: ctNum, id }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

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
        division: c.handgun_div ?? null,
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

      rawScorecards.push({
        competitor_id: compId,
        competitor_division: sc.competitor.handgun_div ?? null,
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
      });
    }
  }

  const stages = computeGroupRankings(rawScorecards, requestedCompetitors);

  const response: CompareResponse = {
    match_id: parseInt(id, 10),
    stages,
    competitors: requestedCompetitors,
  };

  return NextResponse.json(response);
}
