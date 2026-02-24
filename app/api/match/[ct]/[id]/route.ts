import { NextResponse } from "next/server";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY } from "@/lib/graphql";
import cache from "@/lib/cache-impl";

import { formatDivisionDisplay } from "@/lib/divisions";
import type { MatchResponse, StageInfo, CompetitorInfo } from "@/lib/types";

interface RawStage {
  id: string;
  number: number;
  name: string;
  max_points?: number | null; // on IpscStageNode inline fragment
  minimum_rounds?: number | null;
  paper?: number | null;
  popper?: number | null;
  plate?: number | null;
  get_full_absolute_url?: string | null;
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
  const t0 = performance.now();
  const { ct, id } = await params;

  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let data: RawMatchData;
  let cachedAt: string | null;
  try {
    ({ data, cachedAt } = await cachedExecuteQuery<RawMatchData>(
      matchKey,
      MATCH_QUERY,
      { ct: ctNum, id },
      30,
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const tFetch = performance.now();
  console.log(`[match] graphql fetch: ${(tFetch - t0).toFixed(0)}ms`);

  if (!data.event) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const ev = data.event;

  // Determine if match is complete — upgrade to permanent cache if so
  const scoringPct = Math.round(parseFloat(String(ev.scoring_completed ?? 0)));
  const matchDate = ev.starts ? new Date(ev.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const isComplete = scoringPct >= 95 || daysSince > 3;
  if (isComplete) {
    try {
      const raw = await cache.get(matchKey);
      if (raw) await cache.persist(matchKey); // remove TTL → permanent
    } catch { /* ignore */ }
  }

  const stages: StageInfo[] = (ev.stages ?? []).map((s) => ({
    id: parseInt(s.id, 10),
    name: s.name,
    stage_number: s.number,
    max_points: s.max_points ?? 0,
    min_rounds: s.minimum_rounds ?? null,
    paper_targets: s.paper ?? null,
    steel_targets: (s.popper != null || s.plate != null)
      ? (s.popper ?? 0) + (s.plate ?? 0)
      : null,
    ssi_url: s.get_full_absolute_url
      ? `https://${s.get_full_absolute_url}`
      : null,
  }));

  const competitors: CompetitorInfo[] = (
    ev.competitors_approved_w_wo_results_not_dnf ?? []
  ).map((c) => ({
    id: parseInt(c.id, 10),
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
    competitor_number: c.number ?? "",
    club: c.club ?? null,
    division: formatDivisionDisplay(c.get_handgun_div_display ?? c.handgun_div, c.shoots_handgun_major),
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
    ssi_url: `https://shootnscoreit.com/event/${ct}/${id}/`,
    stages,
    competitors,
    cacheInfo: { cachedAt },
  };

  const tDone = performance.now();
  console.log(`[match] total: ${(tDone - t0).toFixed(0)}ms`);

  return NextResponse.json(response, {
    headers: {
      "Server-Timing": [
        `graphql;dur=${(tFetch - t0).toFixed(1)};desc="GraphQL fetch"`,
        `total;dur=${(tDone - t0).toFixed(1)};desc="Total"`,
      ].join(", "),
    },
  });
}
