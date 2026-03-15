/**
 * POST /api/shooter/{shooterId}/add-match
 *
 * Accepts { url: string } where url is a ShootNScoreIt match page URL.
 * Fetches the match data (from cache or GraphQL if not cached), indexes
 * ALL competitors in the match (not just the target shooter), and
 * verifies that the target shooterId is among them.
 *
 * Use this when the backfill scan didn't find a specific match — this
 * endpoint can reach any match on SSI, not just cached ones.
 */
import { NextResponse } from "next/server";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY, SCORECARDS_QUERY } from "@/lib/graphql";
import { computeMatchTtl } from "@/lib/match-ttl";
import { decodeShooterId, indexMatchShooters } from "@/lib/shooter-index";
import { parseMatchUrl } from "@/lib/utils";
import { extractDivision } from "@/lib/divisions";
import db from "@/lib/db-impl";
import type { RawMatchData } from "@/lib/match-data";

interface RawScorecardsResponse {
  event: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const { shooterId: shooterIdStr } = await params;
  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return NextResponse.json({ success: false, message: "Invalid shooterId" }, { status: 400 });
  }

  // GDPR suppression check
  try {
    if (await db.isShooterSuppressed(shooterId)) {
      return NextResponse.json(
        { success: false, message: "This profile has been removed at the owner's request" },
        { status: 410 },
      );
    }
  } catch { /* ignore */ }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ success: false, message: "Missing url field" }, { status: 400 });
  }

  const parsed = parseMatchUrl(body.url.trim());
  if (!parsed) {
    return NextResponse.json(
      { success: false, message: "Could not parse match URL. Expected format: https://shootnscoreit.com/event/{ct}/{id}/" },
      { status: 400 },
    );
  }

  const { ct, id } = parsed;
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ success: false, message: "Invalid content type in URL" }, { status: 400 });
  }

  // Fetch match data (may hit GraphQL if not cached)
  let matchData: RawMatchData;
  try {
    const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
    const ev = await cachedExecuteQuery<RawMatchData>(matchKey, MATCH_QUERY, { ct: ctNum, id }, null);
    matchData = ev.data;

    // Compute proper TTL for this entry
    if (matchData.event) {
      const scoringPct = Math.round(parseFloat(String(matchData.event.scoring_completed ?? 0)));
      const matchDate = matchData.event.starts ? new Date(matchData.event.starts) : null;
      const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 99;
      const ttl = computeMatchTtl(scoringPct, daysSince, matchData.event.starts ?? null);
      // cachedExecuteQuery already wrote with null TTL; correct if needed
      if (ttl !== null) {
        const { default: cache } = await import("@/lib/cache-impl");
        await cache.expire(matchKey, ttl);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Failed to fetch match: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 },
    );
  }

  if (!matchData.event) {
    return NextResponse.json({ success: false, message: "Match not found" }, { status: 404 });
  }

  const matchName = matchData.event.name;

  // Also fetch scorecards to enable full indexing
  try {
    const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
    await cachedExecuteQuery<RawScorecardsResponse>(scorecardsKey, SCORECARDS_QUERY, { ct: ctNum, id }, null);
  } catch {
    // Non-fatal — scorecards may not be available for all matches
  }

  // Build competitor list and index ALL competitors
  const rawCompetitors = matchData.event.competitors_approved_w_wo_results_not_dnf ?? [];
  const competitors = rawCompetitors.map((c) => ({
    shooterId: decodeShooterId(c.shooter?.id),
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
    club: c.club ?? null,
    division: extractDivision(c),
  }));

  indexMatchShooters(ct, id, matchData.event.starts ?? null, competitors);

  // Verify the target shooter is in the competitor list
  const found = competitors.some((c) => c.shooterId === shooterId);
  if (!found) {
    return NextResponse.json({
      success: false,
      message: `You were not found as a competitor in "${matchName}". All competitors have been indexed.`,
      matchName,
    });
  }

  return NextResponse.json({
    success: true,
    message: `Added "${matchName}" to your match history.`,
    matchName,
  });
}
