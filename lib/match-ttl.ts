/**
 * Compute TTL (seconds) for a match cache entry.
 * Returns null for permanent (no expiry).
 *
 * TTL tiers:
 *   completed (see isMatchComplete)           → null (permanent)
 *   active scoring (scoring > 0%)             → 30 s
 *   pre-match, start > 7 days away            → 4 h
 *   pre-match, start 2–7 days away            → 1 h
 *   pre-match, start 0–2 days away            → 30 min
 *   match started, no scoring yet (<12 h)     → 5 min
 *   fallback (unknown state)                  → 30 s
 *
 * All non-null results are clamped to at least MIN_CACHE_TTL_SECONDS
 * (default 30 s; override via the MIN_CACHE_TTL_SECONDS env var). The
 * default lets active matches stay near-real-time courtside — fresh
 * scorecards become visible within ~30 s of the upstream update.
 */

const DEFAULT_MIN_TTL = parseInt(
  process.env.MIN_CACHE_TTL_SECONDS ?? "30",
  10,
);

/**
 * Is a match "done" from our caching/UI perspective?
 *
 * A high `scoring_completed` value on its own is not enough — during an
 * active match day the upstream percentage can cross 95% while some
 * squads still have unscored stages, so we also require at least one full
 * day has passed since the match start. Matches more than 3 days old are
 * considered complete regardless of scoring (handles users viewing
 * historical matches where scoring_completed was never finalised).
 */
export function isMatchComplete(
  scoringPct: number,
  daysSince: number,
): boolean {
  if (daysSince > 3) return true;
  return scoringPct >= 95 && daysSince >= 1;
}

/**
 * Raw freshness window (seconds) for a match cache entry — the "data should
 * be refreshed after this long" signal, before any minimum-TTL clamping.
 *
 * Returns null for permanent (completed) matches. This is the value used as
 * `swrSeconds` by `cachedExecuteQuery` to schedule background refreshes.
 *
 * Distinct from `computeMatchTtl()`, which floors the value at MIN_CACHE_TTL_SECONDS
 * so Redis entries outlive the freshness window — that's what makes
 * stale-while-revalidate possible.
 */
export function computeMatchFreshness(
  scoringPct: number,
  daysSince: number,
  dateStr: string | null,
): number | null {
  if (isMatchComplete(scoringPct, daysSince)) return null;

  if (scoringPct > 0) return 30; // active scoring

  if (dateStr) {
    const hoursUntil = (new Date(dateStr).getTime() - Date.now()) / 3_600_000;
    if (hoursUntil > 7 * 24) return 4 * 60 * 60;
    if (hoursUntil > 2 * 24) return 60 * 60;
    if (hoursUntil > 0) return 30 * 60;
    if (hoursUntil > -12) return 5 * 60;
    return 30; // fallback
  }
  return 30; // fallback (no date)
}

export function computeMatchTtl(
  scoringPct: number,
  daysSince: number, // negative = future match
  dateStr: string | null,
  minTtl = DEFAULT_MIN_TTL,
): number | null {
  const freshness = computeMatchFreshness(scoringPct, daysSince, dateStr);
  if (freshness === null) return null;
  return Math.max(minTtl, freshness);
}

/**
 * Redis TTL floor for match cache entries on SWR-aware code paths.
 *
 * SWR needs `Redis TTL > freshness window` so the entry survives past the
 * freshness threshold and a background refresh can land before eviction.
 * `computeMatchTtl()` returns 30s for active matches (same as freshness),
 * which leaves no SWR room. The 90s floor here equals freshness (30s) plus
 * the upstream GraphQL timeout (60s) — enough for the background refresh
 * to complete before the original entry evicts, without keeping idle
 * entries around longer than necessary.
 */
const SWR_TTL_FLOOR = 90;

export function computeMatchSwrTtl(
  scoringPct: number,
  daysSince: number,
  dateStr: string | null,
): number | null {
  return computeMatchTtl(scoringPct, daysSince, dateStr, SWR_TTL_FLOOR);
}
