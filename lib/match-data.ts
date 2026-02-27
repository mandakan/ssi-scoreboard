// Server-only — fetches and maps match data from the cache/GraphQL layer.
// Shared between the match API route handler and server-side query prefetching
// in the match page server component.

import { cachedExecuteQuery, gqlCacheKey, MATCH_QUERY } from "@/lib/graphql";
import cache from "@/lib/cache-impl";
import { computeMatchTtl } from "@/lib/match-ttl";
import { formatDivisionDisplay } from "@/lib/divisions";
import type { MatchResponse, StageInfo, CompetitorInfo, SquadInfo } from "@/lib/types";

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
    scoring_completed?: string | number | null;
    region?: string | null;
    sub_rule?: string | null;
    level?: string | null;
    stages_count?: number;
    competitors_count?: number;
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

  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  const t0 = performance.now();
  let raw: RawMatchData;
  let cachedAt: string | null;
  try {
    ({ data: raw, cachedAt } = await cachedExecuteQuery<RawMatchData>(
      matchKey,
      MATCH_QUERY,
      { ct: ctNum, id },
      30,
    ));
  } catch {
    return null;
  }
  const msFetch = performance.now() - t0;

  if (!raw.event) return null;

  const ev = raw.event;

  const scoringPct = Math.round(parseFloat(String(ev.scoring_completed ?? 0)));
  const matchDate = ev.starts ? new Date(ev.starts) : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  const isComplete = scoringPct >= 95 || daysSince > 3;
  const ttl = computeMatchTtl(scoringPct, daysSince, ev.starts ?? null);

  try {
    if (ttl === null) {
      const cached = await cache.get(matchKey);
      if (cached) await cache.persist(matchKey);
    } else if (!cachedAt) {
      await cache.expire(matchKey, ttl);
    }
  } catch { /* ignore */ }

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
  }));

  const competitors: CompetitorInfo[] = (
    ev.competitors_approved_w_wo_results_not_dnf ?? []
  ).map((c) => ({
    id: parseInt(c.id, 10),
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
    competitor_number: c.number ?? "",
    club: c.club ?? null,
    division: formatDivisionDisplay(
      c.get_handgun_div_display ?? c.handgun_div,
      c.shoots_handgun_major,
    ),
  }));

  const approvedIds = new Set(competitors.map((c) => c.id));
  const squads: SquadInfo[] = (ev.squads ?? [])
    .map((s) => {
      const competitorIds = (s.competitors ?? [])
        .map((c) => parseInt(c.id, 10))
        .filter((cid) => approvedIds.has(cid))
        .sort((a, b) => a - b);
      return {
        id: parseInt(s.id, 10),
        number: s.number ?? 0,
        name: s.get_squad_display ?? `Squad ${s.number ?? "?"}`,
        competitorIds,
      };
    })
    .filter((s) => s.competitorIds.length > 0);

  const response: MatchResponse = {
    name: ev.name,
    venue: ev.venue ?? null,
    date: ev.starts ?? null,
    level: ev.level ?? null,
    sub_rule: ev.sub_rule ?? null,
    region: ev.region ?? null,
    stages_count: ev.stages_count ?? stages.length,
    competitors_count: ev.competitors_count ?? competitors.length,
    scoring_completed:
      ev.scoring_completed != null
        ? Math.round(parseFloat(String(ev.scoring_completed)))
        : 0,
    ssi_url: `https://shootnscoreit.com/event/${ct}/${id}/`,
    stages,
    competitors,
    squads,
    cacheInfo: { cachedAt },
  };

  return { data: response, cachedAt, isComplete, msFetch };
}
