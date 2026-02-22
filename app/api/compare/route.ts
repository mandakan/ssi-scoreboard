import { NextResponse } from "next/server";
import { executeQuery, SCORECARDS_QUERY, MATCH_QUERY } from "@/lib/graphql";
import { formatDivisionDisplay } from "@/lib/divisions";
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
      executeQuery<RawScorecardsData>(SCORECARDS_QUERY, { ct: ctNum, id }, 30),
      executeQuery<RawMatchData>(MATCH_QUERY, { ct: ctNum, id }, 30),
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
        a_hits: parseNum(sc.ascore),
        c_hits: b !== null || c !== null ? (b ?? 0) + (c ?? 0) : null,
        d_hits: parseNum(sc.dscore),
        miss_count: parseNum(sc.miss),
        no_shoots: parseNum(sc.penalty),
        procedurals: parseNum(sc.procedural),
      });
    }
  }

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

  const stages = computeGroupRankings(rawScorecards, requestedCompetitors).map(
    (s) => ({ ...s, ...stageMetaMap.get(s.stage_id) })
  );

  const response: CompareResponse = {
    match_id: parseInt(id, 10),
    stages,
    competitors: requestedCompetitors,
  };

  return NextResponse.json(response);
}
