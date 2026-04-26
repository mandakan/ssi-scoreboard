// Pre-match coaching brief — AI-generated preparation tip for an upcoming match.
// GET /api/pre-match/brief/[ct]/[id]?shooterId=123
//
// Reads match stage data (from the cached MatchResponse) and the shooter's
// dashboard (from the Redis computed dashboard cache) to build a contextual
// pre-match coaching brief.

import { NextResponse } from "next/server";
import { createAIProvider } from "@/lib/ai-provider";
import { buildPreMatchBriefPrompt, computeSquadContext, PRE_MATCH_PROMPT_VERSION } from "@/lib/pre-match-prompt";
import { fetchMatchData } from "@/lib/match-data";
import { getShooterDashboard } from "@/lib/api-data";
import { isPreMatchEligible } from "@/lib/mode";
import cache from "@/lib/cache-impl";
import type { ShooterDashboardResponse } from "@/lib/types";
import type { CoachingTipResponse } from "@/lib/types";

export const runtime = "nodejs";

/** Cache TTL: 30 minutes. The match context doesn't change pre-match and the
 *  dashboard changes slowly; this is sufficient freshness for a pre-match brief. */
const BRIEF_TTL = 1_800;

/**
 * Load shooter dashboard — Redis cache first, full DB computation on miss.
 * Returns null only when the shooter has no indexed matches at all.
 */
async function loadDashboard(
  shooterId: number,
): Promise<ShooterDashboardResponse | null> {
  // Fast path: return the pre-computed dashboard if it's still in Redis.
  try {
    const raw = await cache.get(`computed:shooter:${shooterId}:dashboard`);
    if (raw) return JSON.parse(raw) as ShooterDashboardResponse;
  } catch { /* non-fatal */ }

  // Slow path: compute from DB + match cache (same logic as GET /api/shooter/[shooterId]).
  // getShooterDashboard() calls the route handler directly — no HTTP round-trip.
  try {
    return await getShooterDashboard(shooterId);
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ct: string; id: string }> },
): Promise<NextResponse<CoachingTipResponse | { error: string }>> {
  const { ct, id } = await params;
  const { searchParams } = new URL(request.url);
  const shooterIdStr = searchParams.get("shooterId");
  const shooterId = shooterIdStr ? parseInt(shooterIdStr, 10) : null;

  const aiProvider = createAIProvider();
  if (!aiProvider) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  // Load match data (usually a Redis cache hit from the match page visit).
  const matchResult = await fetchMatchData(ct, id);
  if (!matchResult) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  const match = matchResult.data;

  // Mirror the frontend's pre-match eligibility gate: the brief stays available
  // while the match isn't fully wrapped up, even if early squads have started
  // scoring (e.g. multi-day matches, RO squads shooting the day before).
  if (
    !isPreMatchEligible({
      scoringPct: match.scoring_completed,
      resultsStatus: match.results_status,
      matchStatus: match.match_status,
    })
  ) {
    return NextResponse.json({ error: "Match no longer in pre-match state" }, { status: 400 });
  }

  // Build a cache key that encodes the prompt version and model.
  const shooterKey = shooterId != null ? String(shooterId) : "anon";
  const briefKey = `pre-match-brief:${ct}:${id}:${shooterKey}:${aiProvider.modelId}:v${PRE_MATCH_PROMPT_VERSION}`;

  // Return cached brief if fresh.
  try {
    const cached = await cache.get(briefKey);
    if (cached) {
      return NextResponse.json(JSON.parse(cached) as CoachingTipResponse);
    }
  } catch { /* non-fatal */ }

  // Load dashboard if a specific shooter is requested.
  const dashboard =
    shooterId != null && isFinite(shooterId)
      ? await loadDashboard(shooterId)
      : null;

  const shooterName = dashboard?.profile?.name ?? null;

  // Compute squad starting context: find the shooter's squad and their position in it.
  let squadContext = null;
  if (shooterId != null) {
    const shooterCompetitor = match.competitors.find((c) => c.shooterId === shooterId);
    if (shooterCompetitor) {
      const squad = match.squads.find((sq) => sq.competitorIds.includes(shooterCompetitor.id));
      if (squad && squad.competitorIds.length > 0) {
        const positionIdx = squad.competitorIds.indexOf(shooterCompetitor.id);
        if (positionIdx >= 0) {
          squadContext = computeSquadContext(positionIdx, squad.competitorIds.length, match.stages);
        }
      }
    }
  }

  const prompt = buildPreMatchBriefPrompt({
    matchName: match.name,
    matchLevel: match.level,
    stages: match.stages,
    shooterName,
    dashboard,
    squadContext,
  });

  let tip: string;
  try {
    // Pre-match brief targets max 55 words — 100 tokens is sufficient with headroom.
    tip = await aiProvider.generateTip(prompt, 100);
  } catch (err) {
    console.error("[pre-match/brief] AI generation failed:", err);
    return NextResponse.json({ error: "AI generation failed" }, { status: 502 });
  }

  const response: CoachingTipResponse = {
    tip: tip.trim(),
    generatedAt: new Date().toISOString(),
    model: aiProvider.modelId,
    competitorId: shooterId ?? 0,
    matchId: id,
    ct,
  };

  // Cache the brief for 30 minutes.
  try {
    await cache.set(briefKey, JSON.stringify(response), BRIEF_TTL);
  } catch { /* non-fatal */ }

  return NextResponse.json(response);
}
