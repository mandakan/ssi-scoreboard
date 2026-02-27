import { NextResponse } from "next/server";
import { fetchMatchData } from "@/lib/match-data";

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

  const result = await fetchMatchData(ct, id);

  if (!result) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const tDone = performance.now();
  const { data: response, cachedAt, isComplete } = result;

  console.log(JSON.stringify({
    route: "match",
    ct: ctNum,
    match_id: id,
    cache_hit: cachedAt !== null,
    competitors_count: response.competitors_count,
    stages_count: response.stages_count,
    scoring_completed: response.scoring_completed,
    is_complete: isComplete,
    ms_graphql: Math.round(result.msFetch),
    ms_total: Math.round(tDone - t0),
  }));

  return NextResponse.json(response, {
    headers: {
      "Server-Timing": [
        `graphql;dur=${result.msFetch.toFixed(1)};desc="GraphQL fetch"`,
        `total;dur=${(tDone - t0).toFixed(1)};desc="Total"`,
      ].join(", "),
    },
  });
}
