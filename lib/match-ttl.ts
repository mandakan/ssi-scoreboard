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

export function computeMatchTtl(
  scoringPct: number,
  daysSince: number, // negative = future match
  dateStr: string | null,
  minTtl = DEFAULT_MIN_TTL,
): number | null {
  if (isMatchComplete(scoringPct, daysSince)) return null; // permanent

  let ttl: number;

  if (scoringPct > 0) {
    ttl = 30; // active scoring
  } else if (dateStr) {
    const hoursUntil = (new Date(dateStr).getTime() - Date.now()) / 3_600_000;
    if (hoursUntil > 7 * 24) ttl = 4 * 60 * 60; // > 7 days
    else if (hoursUntil > 2 * 24) ttl = 60 * 60; // 2–7 days
    else if (hoursUntil > 0) ttl = 30 * 60; // 0–2 days
    else if (hoursUntil > -12) ttl = 5 * 60; // just started
    else ttl = 30; // fallback
  } else {
    ttl = 30; // fallback (no date)
  }

  return Math.max(minTtl, ttl);
}
