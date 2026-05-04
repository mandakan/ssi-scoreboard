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
 * Heuristic completion thresholds.
 *
 * `MATCH_COMPLETE_DAYS_SINCE` (default 3) — minimum days since match start
 * before we will permanently pin the cache. This is a HARD time gate: even
 * an SSI-flagged "cp" status or `results === "all"` cannot pin a match
 * earlier than this. Reason: organizers sometimes flip those flags before
 * every RO has submitted scorecards (this was the Skepplanda Apr 2026 bug),
 * and Level V World Shoots run 5+ days. Three days covers any normal
 * 1-3 day match plus a full day-after window for late scorecards. Raise
 * the env var for events with longer scoring tails.
 *
 * `MATCH_COMPLETE_SCORING_PCT` (default 98) — scoring percentage required
 * for the un-flagged heuristic path. Some matches finish at 99-100%, others
 * legitimately end at 85-90% (the API survey shows L2 matches at 85.7%
 * and 87.8% with `status="cp"` — squads that simply didn't submit). 98%
 * means we never auto-pin matches still actively accruing scorecards
 * without falling back to the historical 7-day cutoff.
 *
 * `HISTORICAL_FALLBACK_DAYS` (constant, 7) — at this age, anything is
 * considered done. Hard-coded since it's a safety hatch, not a tuning knob.
 */
const HEURISTIC_DAYS_SINCE = parseFloat(
  process.env.MATCH_COMPLETE_DAYS_SINCE ?? "3",
);
const HEURISTIC_SCORING_PCT = parseFloat(
  process.env.MATCH_COMPLETE_SCORING_PCT ?? "98",
);
const HISTORICAL_FALLBACK_DAYS = 7;

export interface MatchSsiSignals {
  /** SSI `match_status` field. "cp" = completed, "cs" = cancelled, "on" = ongoing, etc. */
  status?: string | null;
  /** True when SSI `results_status === "all"` (organizer published official results). */
  resultsPublished?: boolean;
}

/**
 * Is a match definitively "done" — safe to cache permanently and stop
 * hitting the upstream API?
 *
 * Decision tree:
 *
 * 1. **Cancelled** (`status === "cs"`): immediately terminal — no
 *    scoring will ever resume.
 *
 * 2. **Historical** (`daysSince > 7`): any match this old will not
 *    change in practice; safe to pin.
 *
 * 3. **Time gate** (`daysSince <= MATCH_COMPLETE_DAYS_SINCE`, default 3):
 *    nothing else qualifies. This applies *even when SSI flagged the match
 *    as complete* — late RO scorecard submissions arrive for hours after
 *    the last shot, and organizers occasionally flip the flag early. The
 *    Skepplanda Apr 2026 bug was caused by trusting these flags during
 *    the match window; the time gate prevents that recurrence.
 *
 * 4. **Past the time gate**: any of these signals qualifies as "done":
 *    - SSI status is "cp" (completed)
 *    - SSI results published (`results === "all"`)
 *    - Scoring percentage >= MATCH_COMPLETE_SCORING_PCT (default 98)
 *
 *    Everything else continues to refresh actively.
 */
export function isMatchComplete(
  scoringPct: number,
  daysSince: number,
  signals: MatchSsiSignals = {},
): boolean {
  // Cancelled — terminal regardless of timing.
  if (signals.status === "cs") return true;

  // Historical fallback for very old matches.
  if (daysSince > HISTORICAL_FALLBACK_DAYS) return true;

  // Hard time gate: nothing pins during the match window or just after,
  // even an SSI-flagged cp/results=all match. Protects against premature
  // flag flips by organizers.
  if (daysSince <= HEURISTIC_DAYS_SINCE) return false;

  // Past the time gate: any one of the completion signals qualifies.
  if (signals.status === "cp") return true;
  if (signals.resultsPublished === true) return true;
  if (scoringPct >= HEURISTIC_SCORING_PCT) return true;
  return false;
}

/**
 * High-level form of `isMatchComplete()` that takes the raw fields callers
 * already have on hand (an effective scoring percentage, a start-date string
 * or Date, the SSI status, and the SSI results status). Computes `daysSince`
 * and the signals object internally so each call site doesn't repeat that
 * arithmetic.
 *
 * Use this whenever you have a match-event-shaped object; reach for the
 * primitive `isMatchComplete()` only when the inputs come from somewhere
 * non-event-shaped (e.g. a synthetic test fixture).
 */
export interface MatchCompletionInputs {
  /** Effective scoring percentage (0-100). Use `effectiveMatchScoringPct(ev)` to derive. */
  scoringPct: number;
  /** Match start date — accepts ISO string, Date, or null/undefined for unknown. */
  startDate: string | Date | null | undefined;
  /** SSI `event.status` field — pass through unchanged. */
  status: string | null | undefined;
  /** SSI `event.results` field — pass through unchanged. The helper handles the `=== "all"` check. */
  resultsStatus: string | null | undefined;
}

export function isMatchCompleteFromEvent(input: MatchCompletionInputs): boolean {
  const matchDate = input.startDate
    ? input.startDate instanceof Date
      ? input.startDate
      : new Date(input.startDate)
    : null;
  const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 0;
  return isMatchComplete(input.scoringPct, daysSince, {
    status: input.status ?? null,
    resultsPublished: input.resultsStatus === "all",
  });
}

/**
 * Is the match scoring "settled enough" for downstream consumers that need
 * authoritative data — e.g. coaching tips, achievement evaluation? Distinct
 * from `isMatchComplete()`, which gates *permanent cache pinning* and so
 * has a hard time gate to protect against premature SSI flag flips. This
 * function is purely a "do we trust the data right now?" check; it does
 * NOT drive any cache durability decision, so the time gate is not needed.
 *
 * Returns true when:
 *   - SSI says the match is cancelled, completed, or has published results
 *   - OR scoring is at 100% (every approved competitor has every stage scored)
 *   - OR more than 7 days have passed (historical fallback)
 */
export function isMatchScoringSettled(
  scoringPct: number,
  daysSince: number,
  signals: MatchSsiSignals = {},
): boolean {
  if (signals.status === "cs") return true;
  if (signals.status === "cp") return true;
  if (signals.resultsPublished === true) return true;
  if (daysSince > HISTORICAL_FALLBACK_DAYS) return true;
  return scoringPct >= 100;
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
  signals: MatchSsiSignals = {},
): number | null {
  if (isMatchComplete(scoringPct, daysSince, signals)) return null;

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
  signals: MatchSsiSignals = {},
): number | null {
  const freshness = computeMatchFreshness(scoringPct, daysSince, dateStr, signals);
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
  signals: MatchSsiSignals = {},
): number | null {
  return computeMatchTtl(scoringPct, daysSince, dateStr, SWR_TTL_FLOOR, signals);
}
