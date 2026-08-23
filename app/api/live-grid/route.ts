import { NextResponse } from "next/server";
import { MAX_LIVE_GRID_ROWS } from "@/lib/constants";
import { reportError } from "@/lib/error-telemetry";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  cachedExecuteQuery,
  gqlCacheKey,
  MATCH_QUERY,
  refreshCachedMatchQuery,
} from "@/lib/graphql";
import { getMatchScorecards } from "@/lib/scorecards-archive";
import cache from "@/lib/cache-impl";
import {
  computeMatchFreshness,
  computeMatchSwrTtl,
  isMatchComplete,
} from "@/lib/match-ttl";
import { withJitter } from "@/lib/jitter";
import { persistToMatchStore } from "@/lib/match-data-store";
import { computeMatchScoringPct } from "@/lib/match-data";
import { isUpstreamDegraded } from "@/lib/upstream-status";
import { isSsiUpstreamPaused } from "@/lib/upstream-pause";
import { afterResponse } from "@/lib/background-impl";
import { extractDivision } from "@/lib/divisions";
import { decodeShooterId } from "@/lib/shooter-index";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import { buildLiveGridCells } from "@/lib/live-grid";
import { maybeTagAsMcp } from "@/lib/telemetry-context";
import type {
  LiveGridResponse,
  LiveGridShooter,
  LiveGridStage,
} from "@/lib/types";

interface RawCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  get_division_display?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  shooter?: { id: string } | null;
}

// Distinct from compare's RawMatchData: the grid needs `squads` (for each
// shooter's squad label) and none of the stage geometry fields.
interface RawMatchData {
  event: {
    starts?: string | null;
    status?: string | null;
    results?: string | null;
    is_live_scores_accessible?: boolean | null;
    stages?: {
      id: string;
      number: number;
      name: string;
      max_points: number;
      scoring_progress?: { scored?: number | null; total?: number | null } | null;
    }[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
    squads?: { id: string; number?: number | null; get_squad_display?: string | null;
               competitors?: { id: string }[] }[];
  } | null;
}

/**
 * GET /api/live-grid?ct=&id=&competitor_ids=
 *
 * Field-blind by contract. Every value returned here comes from one shooter's
 * own scorecard plus the stage list. Adding a stage-winner HF, field median,
 * or ranking would break the Phase 2 swap described in
 * docs/superpowers/specs/2026-08-23-live-grid-design.md -- at which point this
 * route stops reading the whole-field snapshot and fetches per competitor
 * instead, with no client change.
 *
 * Cache, TTL and stale-while-revalidate handling deliberately mirrors
 * app/api/compare/route.ts rather than inventing a variant, and introduces no
 * second poll clock.
 */
export async function GET(req: Request) {
  maybeTagAsMcp(req);
  const rl = await checkRateLimit(req, {
    prefix: "live-grid",
    // Higher than compare's 30: the response is a fraction of the size and
    // costs no field-wide compute.
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const ct = searchParams.get("ct");
  const id = searchParams.get("id");
  const idsParam = searchParams.get("competitor_ids");

  if (!ct || !id || !idsParam) {
    return NextResponse.json(
      { error: "Required params: ct, id, competitor_ids" },
      { status: 400 },
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

  if (competitorIds.length === 0 || competitorIds.length > MAX_LIVE_GRID_ROWS) {
    return NextResponse.json(
      { error: `Between 1 and ${MAX_LIVE_GRID_ROWS} competitor_ids required` },
      { status: 400 },
    );
  }

  // ── Match metadata (drives TTL, and supplies stages/competitors/squads) ────
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  let matchData: RawMatchData;
  let matchCachedAt: string | null;
  try {
    ({ data: matchData, cachedAt: matchCachedAt } =
      await cachedExecuteQuery<RawMatchData>(
        matchKey,
        MATCH_QUERY,
        { ct: ctNum, id },
        30,
      ));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const scoringPct = computeMatchScoringPct(matchData.event);
  const matchDate = matchData.event?.starts ? new Date(matchData.event.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const signals = {
    status: matchData.event?.status ?? null,
    resultsPublished: matchData.event?.results === "all",
  };
  const isComplete = isMatchComplete(scoringPct, daysSince, signals);
  const dataTtl = computeMatchSwrTtl(
    scoringPct,
    daysSince,
    matchData.event?.starts ?? null,
    signals,
  );

  try {
    if (dataTtl === null) {
      // Pin only when the completion inputs came from a fresh upstream fetch.
      if (!matchCachedAt) {
        const raw = await cache.get(matchKey);
        if (raw) {
          await cache.persist(matchKey);
          afterResponse(persistToMatchStore(matchKey, raw));
        }
      }
    } else if (!matchCachedAt) {
      await cache.expire(matchKey, dataTtl);
    }
  } catch (err) {
    reportError("live-grid.match-ttl-apply", err, { matchKey });
  }

  const matchFreshness = computeMatchFreshness(
    scoringPct,
    daysSince,
    matchData.event?.starts ?? null,
    signals,
  );
  if (matchCachedAt && dataTtl != null && matchFreshness != null) {
    const age = (Date.now() - new Date(matchCachedAt).getTime()) / 1000;
    if (age > withJitter(matchFreshness)) {
      afterResponse(
        refreshCachedMatchQuery<RawMatchData>(
          matchKey,
          MATCH_QUERY,
          { ct: ctNum, id },
          dataTtl,
          { ct: ctNum, id },
        ),
      );
    }
  }

  const stages: LiveGridStage[] = (matchData.event?.stages ?? []).map((s) => ({
    stage_id: parseInt(s.id, 10),
    stage_num: s.number,
    name: s.name,
    max_points: s.max_points ?? 0,
  }));

  // competitorId -> squad label, from the already-cached match response.
  const squadByCompetitor = new Map<number, string>();
  for (const sq of matchData.event?.squads ?? []) {
    const label = sq.get_squad_display || (sq.number != null ? String(sq.number) : null);
    if (!label) continue;
    for (const c of sq.competitors ?? []) {
      squadByCompetitor.set(parseInt(c.id, 10), label);
    }
  }

  const requested = new Set(competitorIds);
  const shooters: LiveGridShooter[] = (
    matchData.event?.competitors_approved_w_wo_results_not_dnf ?? []
  )
    .map((c) => ({ raw: c, id: parseInt(c.id, 10) }))
    .filter(({ id: cid }) => requested.has(cid))
    .map(({ raw, id: cid }) => ({
      id: cid,
      shooterId: decodeShooterId(raw.shooter?.id),
      name: [raw.first_name, raw.last_name].filter(Boolean).join(" ") || "Unknown",
      competitor_number: raw.number ?? "",
      division: extractDivision(raw),
      squad: squadByCompetitor.get(cid) ?? null,
    }))
    // Preserve the caller's row order -- resolveGridRows puts "me" first.
    .sort((a, b) => competitorIds.indexOf(a.id) - competitorIds.indexOf(b.id));

  const cacheInfo: LiveGridResponse["cacheInfo"] = { cachedAt: matchCachedAt };
  if (isSsiUpstreamPaused()) cacheInfo.upstreamPaused = true;

  // Live match whose organizer has not published scores: SSI returns empty
  // scorecards, so short-circuit rather than fetching them.
  if (!isComplete && matchData.event?.is_live_scores_accessible !== true) {
    return NextResponse.json({
      match_id: parseInt(id, 10),
      stages,
      shooters,
      cells: Object.fromEntries(competitorIds.map((cid) => [cid, {}])),
      cacheInfo,
      scorecardsRestricted: true,
    } satisfies LiveGridResponse);
  }

  // ── Scorecards ────────────────────────────────────────────────────────────
  const stageRefs = (matchData.event?.stages ?? []).map((s) => ({
    ct: 24,
    id: s.id,
  }));
  let scorecardsData: RawScorecardsData;
  let scorecardsCachedAt: string | null;
  try {
    ({ data: scorecardsData, cachedAt: scorecardsCachedAt } =
      await getMatchScorecards({
        ct: ctNum,
        matchId: id,
        stages: stageRefs,
        ttlSeconds: isComplete ? null : dataTtl,
        freshnessSeconds: isComplete ? null : matchFreshness,
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const rawScorecards = parseRawScorecards(scorecardsData);
  const cells = buildLiveGridCells(rawScorecards, competitorIds);

  cacheInfo.scorecardsCachedAt = scorecardsCachedAt;
  let lastScorecardAt: string | null = null;
  for (const sc of rawScorecards) {
    if (
      sc.scorecard_created &&
      (!lastScorecardAt || sc.scorecard_created > lastScorecardAt)
    ) {
      lastScorecardAt = sc.scorecard_created;
    }
  }
  if (lastScorecardAt) cacheInfo.lastScorecardAt = lastScorecardAt;
  if (cacheInfo.cachedAt && (await isUpstreamDegraded())) {
    cacheInfo.upstreamDegraded = true;
  }

  // SSI hides per-shot detail on Level I matches: non-zero scoring but an
  // empty scorecards array.
  const scorecardsRestricted =
    scoringPct > 0 && rawScorecards.length === 0 && stages.length > 0;

  return NextResponse.json({
    match_id: parseInt(id, 10),
    stages,
    shooters,
    cells,
    cacheInfo,
    ...(scorecardsRestricted ? { scorecardsRestricted: true } : {}),
  } satisfies LiveGridResponse);
}
