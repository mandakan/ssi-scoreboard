/**
 * Compute TTL (seconds) for a match cache entry.
 * Returns null for permanent (no expiry).
 *
 * TTL tiers:
 *   completed (scoring ≥95% OR >3 days old)  → null (permanent)
 *   active scoring (scoring > 0%)             → 30 s
 *   pre-match, start > 7 days away            → 4 h
 *   pre-match, start 2–7 days away            → 1 h
 *   pre-match, start 0–2 days away            → 30 min
 *   match started, no scoring yet (<12 h)     → 5 min
 *   fallback (unknown state)                  → 30 s
 */
export function computeMatchTtl(
  scoringPct: number,
  daysSince: number, // negative = future match
  dateStr: string | null,
): number | null {
  if (scoringPct >= 95 || daysSince > 3) return null; // permanent
  if (scoringPct > 0) return 30; // active scoring

  if (dateStr) {
    const hoursUntil = (new Date(dateStr).getTime() - Date.now()) / 3_600_000;
    if (hoursUntil > 7 * 24) return 4 * 60 * 60; // > 7 days
    if (hoursUntil > 2 * 24) return 60 * 60; // 2–7 days
    if (hoursUntil > 0) return 30 * 60; // 0–2 days
    if (hoursUntil > -12) return 5 * 60; // just started
  }

  return 30; // fallback
}
