// Server-only — fetches and maps match data from the cache/GraphQL layer.
// Shared between the match API route handler and server-side query prefetching
// in the match page server component.

import { cache } from "react";
import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY, refreshCachedMatchQuery } from "@/lib/graphql";
import cacheAdapter from "@/lib/cache-impl";
import { computeMatchFreshness, computeMatchSwrTtl, isMatchComplete } from "@/lib/match-ttl";
import { extractDivision } from "@/lib/divisions";
import { decodeShooterId, indexMatchShooters } from "@/lib/shooter-index";
import { afterResponse } from "@/lib/background-impl";
import { persistToMatchStore } from "@/lib/match-data-store";
import { isUpstreamDegraded } from "@/lib/upstream-status";
import { cacheTelemetry } from "@/lib/cache-telemetry";
import { reportError } from "@/lib/error-telemetry";
import type { MatchResponse, StageInfo, CompetitorInfo, SquadInfo } from "@/lib/types";

// ── Effective match-level scoring percentage ────────────────────────────────
//
// SSI's match-level `event.scoring_completed` aggregate is unreliable: it can
// return "0" while every stage independently reports 20-30% scored (observed
// during SPSK Open 2026, match 22/27190). A 0 here cascades into the
// "match started, no scoring yet" TTL tier (5 min freshness) and freezes the
// scoreboard for users courtside.
//
// `effectiveMatchScoringPct` trusts the match-level value when it is plausible
// and falls back to the unweighted mean of per-stage `scoring_completed`
// values whenever it is materially lower than the stage average. This catches
// the bug without changing behaviour for healthy matches.

interface MatchEventForScoring {
  scoring_completed?: string | number | null;
  stages?: Array<{ scoring_completed?: string | number | null }> | null;
}

export function effectiveMatchScoringPct(event: MatchEventForScoring | null | undefined): number {
  if (!event) return 0;
  const matchPct = event.scoring_completed != null
    ? parseFloat(String(event.scoring_completed))
    : 0;
  const stagePcts = (event.stages ?? [])
    .map((s) => (s?.scoring_completed != null ? parseFloat(String(s.scoring_completed)) : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (stagePcts.length === 0) return matchPct;
  const stageMean = stagePcts.reduce((a, b) => a + b, 0) / stagePcts.length;
  // 1 percentage point of slack absorbs rounding while still catching the
  // "match=0, stages=29%" failure mode.
  return stageMean > matchPct + 1 ? stageMean : matchPct;
}

// ── Raw GraphQL response shapes ─────────────────────────────────────────────

interface RawStage {
  id: string;
  number: number;
  name: string;
  max_points?: number | null;
  minimum_rounds?: number | null;
  paper?: number | null;
  popper?: number | null;
  plate?: number | null;
  get_full_absolute_url?: string | null;
  course?: string | null;
  get_course_display?: string | null;
  procedure?: string | null;
  firearm_condition?: string | null;
  /** Per-stage scoring percentage as a decimal string (e.g. "29.487179487179485").
   *  Added in cache schema v15 — used to derive a match-level percentage when
   *  SSI's own `event.scoring_completed` aggregate is broken. */
  scoring_completed?: string | number | null;
}

interface RawCompetitor {
  id: string;
  get_content_type_key: number;
  first_name?: string;
  last_name?: string;
  number?: string;
  club?: string | null;
  /** Universal division display field — populated for all IPSC disciplines. Added in cache schema v8. */
  get_division_display?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  shoots_handgun_major?: boolean | null;
  region?: string | null;
  get_region_display?: string | null;
  category?: string | null;
  ics_alias?: string | null;
  license?: string | null;
  shooter?: { id: string } | null;
}

interface RawSquad {
  id: string;
  number?: number;
  get_squad_display?: string;
  competitors?: Array<{ id: string }>;
}

export interface RawMatchData {
  event: {
    id: string;
    get_content_type_key: number;
    name: string;
    starts: string | null;
    venue?: string | null;
    status?: string | null;
    results?: string | null;
    scoring_completed?: string | number | null;
    region?: string | null;
    sub_rule?: string | null;
    get_full_rule_display?: string | null;
    level?: string | null;
    stages_count?: number;
    competitors_count?: number;
    has_geopos?: boolean | null;
    lat?: number | string | null;
    lng?: number | string | null;
    ends?: string | null;
    registration_starts?: string | null;
    registration_closes?: string | null;
    squadding_starts?: string | null;
    squadding_closes?: string | null;
    is_registration_possible?: boolean | null;
    is_squadding_possible?: boolean | null;
    max_competitors?: number | null;
    registration?: string | null;
    image?: { url?: string | null; width?: number | null; height?: number | null } | null;
    stages?: RawStage[];
    competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
    squads?: RawSquad[];
  } | null;
}

export interface FetchMatchResult {
  data: MatchResponse;
  cachedAt: string | null;
  isComplete: boolean;
  /** Milliseconds spent in the GraphQL/cache fetch. */
  msFetch: number;
}

/**
 * React-cache-deduplicated raw match query fetch.
 * Within a single Next.js server render, the first caller hits Redis (or
 * GraphQL on a cache miss). All subsequent callers in the same render receive
 * the memoised result — so layout.tsx generateMetadata() and the page Server
 * Component never issue two separate Redis round-trips for the same match.
 */
export const fetchRawMatchData = cache(
  async (ctNum: number, id: string): Promise<{ data: RawMatchData; cachedAt: string | null }> => {
    const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
    return cachedExecuteQuery<RawMatchData>(matchKey, MATCH_QUERY, { ct: ctNum, id }, 30);
  },
);

/**
 * Fetch, map, and TTL-correct a match from the cache/GraphQL layer.
 * Server-only — never import from client components or files under `lib/`
 * that are imported by client components.
 *
 * Returns null if `ct` is not a valid integer, the upstream fetch fails,
 * or the match does not exist.
 */
export async function fetchMatchData(
  ct: string,
  id: string,
): Promise<FetchMatchResult | null> {
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) return null;

  const t0 = performance.now();
  let raw: RawMatchData;
  let cachedAt: string | null;
  try {
    ({ data: raw, cachedAt } = await fetchRawMatchData(ctNum, id));
  } catch {
    return null;
  }
  const msFetch = performance.now() - t0;
  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });

  if (!raw.event) return null;

  const ev = raw.event;

  const scoringPct = effectiveMatchScoringPct(ev);
  const matchDate = ev.starts ? new Date(ev.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const resultsPublished = ev.results === "all";
  const signals = { status: ev.status ?? null, resultsPublished };
  // Cache permanently only when truly done — see `isMatchComplete` for the
  // full decision tree. The hard time gate inside `isMatchComplete` is what
  // prevents the Skepplanda-style premature pinning bug: even if SSI flips
  // status="cp" or results="all" mid-match, we keep refreshing for the full
  // match window plus a margin so late RO scorecards still surface.
  const trulyDone = isMatchComplete(scoringPct, daysSince, signals);
  const ttl = trulyDone
    ? null
    : computeMatchSwrTtl(scoringPct, daysSince, ev.starts ?? null, signals);
  // `isComplete` flag (returned to callers / used for UI badges) stays
  // lenient — once results are published or scoring is high we treat the
  // match as "done enough" to display, even if we keep refreshing.
  const isComplete = trulyDone || resultsPublished;
  cacheTelemetry({
    op: "match-ttl-decision",
    matchKey,
    scoringPct,
    daysSince,
    status: ev.status ?? null,
    resultsPublished,
    trulyDone,
    ttl,
  });

  try {
    if (ttl === null) {
      const cached = await cacheAdapter.get(matchKey);
      if (cached) {
        await cacheAdapter.persist(matchKey);
        // Persist completed match data to D1/SQLite for durable storage
        afterResponse(persistToMatchStore(matchKey, cached));
      }
    } else if (!cachedAt) {
      await cacheAdapter.expire(matchKey, ttl);
    }
  } catch (err) {
    reportError("match-data.ttl-apply", err, { matchKey });
  }

  // Stale-while-revalidate: a cache hit older than the freshness window
  // triggers a single-flight background refresh. The current request returns
  // cached data immediately; the next poll (client polls every 30s while
  // matches are active) sees the refreshed entry.
  const freshness = computeMatchFreshness(scoringPct, daysSince, ev.starts ?? null);
  if (cachedAt && ttl != null && freshness != null) {
    const ageSeconds = (Date.now() - new Date(cachedAt).getTime()) / 1000;
    if (ageSeconds > freshness) {
      afterResponse(
        refreshCachedMatchQuery<RawMatchData>(
          matchKey,
          MATCH_QUERY,
          { ct: ctNum, id },
          ttl,
          { ct: ctNum, id },
        ),
      );
    }
  }

  const stages: StageInfo[] = (ev.stages ?? []).map((s) => ({
    id: parseInt(s.id, 10),
    name: s.name,
    stage_number: s.number,
    max_points: s.max_points ?? 0,
    min_rounds: s.minimum_rounds ?? null,
    paper_targets: s.paper ?? null,
    steel_targets:
      s.popper != null || s.plate != null
        ? (s.popper ?? 0) + (s.plate ?? 0)
        : null,
    ssi_url: s.get_full_absolute_url
      ? `https://${s.get_full_absolute_url}`
      : null,
    course_display: s.get_course_display ?? null,
    procedure: s.procedure ?? null,
    firearm_condition: s.firearm_condition ?? null,
  }));

  const competitors: CompetitorInfo[] = (
    ev.competitors_approved_w_wo_results_not_dnf ?? []
  ).map((c) => ({
    id: parseInt(c.id, 10),
    shooterId: decodeShooterId(c.shooter?.id),
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
    competitor_number: c.number ?? "",
    club: c.club ?? null,
    division: extractDivision(c),
    region: c.region || null,
    region_display: c.get_region_display || null,
    category: c.category || null,
    ics_alias: c.ics_alias || null,
    license: c.license || null,
  }));

  const approvedIds = new Set(competitors.map((c) => c.id));
  // Build a lookup for sorting squad members by their competitor (bib) number.
  const competitorById = new Map(competitors.map((c) => [c.id, c]));
  const squads: SquadInfo[] = (ev.squads ?? [])
    .map((s) => {
      const competitorIds = (s.competitors ?? [])
        .map((c) => parseInt(c.id, 10))
        .filter((cid) => approvedIds.has(cid))
        .sort((a, b) => {
          // Sort by competitor (bib) number — this reflects typical within-squad
          // shooting order. Numeric numbers are sorted numerically; non-numeric
          // alphabetically; numeric before non-numeric.
          const na = parseInt(competitorById.get(a)?.competitor_number ?? "", 10);
          const nb = parseInt(competitorById.get(b)?.competitor_number ?? "", 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          if (!isNaN(na)) return -1;
          if (!isNaN(nb)) return 1;
          return (competitorById.get(a)?.competitor_number ?? "").localeCompare(
            competitorById.get(b)?.competitor_number ?? "",
          );
        });
      return {
        id: parseInt(s.id, 10),
        number: s.number ?? 0,
        name: s.get_squad_display ?? `Squad ${s.number ?? "?"}`,
        competitorIds,
      };
    })
    .filter((s) => s.competitorIds.length > 0);

  // Build cross-match shooter index. `indexMatchShooters` self-throttles per
  // match via a Redis lock so a popular match polled by many viewers only
  // re-indexes at most once per throttle window. Without throttling, each
  // match page view (or 30s active-match poll) replays ~2 D1 writes per
  // competitor + 1 per match — a 200-competitor match is ~400 writes per view.
  //
  // Registered with afterResponse() so the promise completes even after the
  // HTTP response is sent (required on CF Workers).
  afterResponse(indexMatchShooters(ct, id, ev.starts ?? null, competitors, {
    name: ev.name,
    venue: ev.venue ?? null,
    date: ev.starts ?? null,
    level: ev.level ?? null,
    region: ev.region ?? null,
    subRule: ev.sub_rule ?? null,
    discipline: ev.get_full_rule_display ?? null,
    status: ev.status ?? null,
    resultsStatus: ev.results ?? null,
    scoringCompleted: scoringPct,
    competitorsCount: ev.competitors_count ?? competitors.length,
    stagesCount: ev.stages_count ?? stages.length,
    lat: ev.has_geopos && ev.lat != null ? parseFloat(String(ev.lat)) : null,
    lng: ev.has_geopos && ev.lng != null ? parseFloat(String(ev.lng)) : null,
    registrationStarts: ev.registration_starts ?? null,
    registrationCloses: ev.registration_closes ?? null,
    registrationStatus: ev.registration ?? null,
    squaddingStarts: ev.squadding_starts ?? null,
    squaddingCloses: ev.squadding_closes ?? null,
    isRegistrationPossible: ev.is_registration_possible ?? false,
    isSquaddingPossible: ev.is_squadding_possible ?? false,
    maxCompetitors: ev.max_competitors ?? null,
  }));

  const response: MatchResponse = {
    name: ev.name,
    venue: ev.venue ?? null,
    lat: ev.has_geopos && ev.lat != null ? parseFloat(String(ev.lat)) : null,
    lng: ev.has_geopos && ev.lng != null ? parseFloat(String(ev.lng)) : null,
    date: ev.starts ?? null,
    ends: ev.ends ?? null,
    level: ev.level ?? null,
    sub_rule: ev.sub_rule ?? null,
    discipline: ev.get_full_rule_display ?? null,
    region: ev.region ?? null,
    stages_count: ev.stages_count ?? stages.length,
    competitors_count: ev.competitors_count ?? competitors.length,
    max_competitors: ev.max_competitors ?? null,
    scoring_completed: effectiveMatchScoringPct(ev),
    match_status: ev.status ?? "on",
    results_status: ev.results ?? "org",
    registration_status: ev.registration ?? "cl",
    registration_starts: ev.registration_starts ?? null,
    registration_closes: ev.registration_closes ?? null,
    is_registration_possible: ev.is_registration_possible ?? false,
    squadding_starts: ev.squadding_starts ?? null,
    squadding_closes: ev.squadding_closes ?? null,
    is_squadding_possible: ev.is_squadding_possible ?? false,
    ssi_url: `https://shootnscoreit.com/event/${ct}/${id}/`,
    stages,
    competitors,
    squads,
    cacheInfo: { cachedAt },
  };

  // Decorate with upstream-degraded flag so the client can surface a banner.
  // Only meaningful for cache hits — a fresh fetch by definition means upstream
  // just succeeded for this caller.
  if (cachedAt && (await isUpstreamDegraded())) {
    response.cacheInfo.upstreamDegraded = true;
  }

  return { data: response, cachedAt, isComplete, msFetch };
}
