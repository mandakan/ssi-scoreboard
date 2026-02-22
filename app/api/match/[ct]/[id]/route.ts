import { NextResponse } from "next/server";
import { executeQuery, MATCH_QUERY } from "@/lib/graphql";
import type { MatchResponse, StageInfo, CompetitorInfo } from "@/lib/types";

interface RawStage {
  id: string;
  number: number;
  name: string;
  max_points?: number | null; // on IpscStageNode inline fragment
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
    id: string;
    get_content_type_key: number;
    name: string;
    starts: string | null;
    venue?: string | null;
    // scoring_completed is a decimal string from the API, e.g. "56.31067961165048"
    scoring_completed?: string | number | null;
    region?: string | null;
    sub_rule?: string | null;
    level?: string | null;
    stages_count?: number;
    competitors_count?: number;
    stages?: RawStage[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
  } | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ct: string; id: string }> }
) {
  const { ct, id } = await params;

  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  let data: RawMatchData;
  try {
    data = await executeQuery<RawMatchData>(MATCH_QUERY, { ct: ctNum, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!data.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const ev = data.event;

  const stages: StageInfo[] = (ev.stages ?? []).map((s) => ({
    id: parseInt(s.id, 10),
    name: s.name,
    stage_number: s.number,
    max_points: s.max_points ?? 0,
  }));

  const competitors: CompetitorInfo[] = (
    ev.competitors_approved_w_wo_results_not_dnf ?? []
  ).map((c) => ({
    id: parseInt(c.id, 10),
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
    competitor_number: c.number ?? "",
    club: c.club ?? null,
    division: c.handgun_div ?? null,
  }));

  const response: MatchResponse = {
    name: ev.name,
    venue: ev.venue ?? null,
    date: ev.starts ?? null,
    level: ev.level ?? null,
    sub_rule: ev.sub_rule ?? null,
    region: ev.region ?? null,
    stages_count: ev.stages_count ?? stages.length,
    competitors_count: ev.competitors_count ?? competitors.length,
    // scoring_completed comes as a decimal string from the API; convert to 0-100 number
    scoring_completed: ev.scoring_completed != null
      ? Math.round(parseFloat(String(ev.scoring_completed)))
      : 0,
    stages,
    competitors,
  };

  return NextResponse.json(response);
}
