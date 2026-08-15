// Redis-shared exponential backoff for the SSI GraphQL upstream.
//
// SSI ask #8 (2026-08-15 incident): back off exponentially on 429/5xx.
// Because the state lives in Redis it is shared across ALL worker isolates —
// this, together with the per-key single-flight locks, is the cross-instance
// half of our throttling story (the per-isolate semaphore in
// lib/upstream-limiter.ts is the other half).
//
// Semantics:
//  - Failure (429/5xx/timeout): level++, hold off for min(5s * 2^level, 600s),
//    or the upstream's Retry-After when that is larger.
//  - While the hold-off is active, `assertNotInBackoff` throws BEFORE any
//    network I/O; stale-on-error keeps serving cached data.
//  - Half-open: a success only clears the state once the hold-off has
//    elapsed. A success racing a 429 inside the window must not reset the
//    level (flapping).
//  - Everything is best-effort: cache down -> no gate, never a user error.

import cache from "@/lib/cache-impl";

export const BACKOFF_KEY = "upstream:backoff";

export const UPSTREAM_BACKOFF_ERROR =
  "Backing off from ShootNScoreIt after upstream errors. Saved results are still available.";

const BASE_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 600;
// Keep state around long enough to escalate across consecutive failures, but
// let a quiet hour fully forget past trouble.
const STATE_TTL_SECONDS = 3600;

interface BackoffState {
  level: number;
  untilIso: string;
}

export function computeBackoffDelaySeconds(level: number, retryAfter: string | null): number {
  const exponential = Math.min(BASE_DELAY_SECONDS * 2 ** level, MAX_DELAY_SECONDS);
  if (retryAfter != null) {
    const ra = parseInt(retryAfter, 10);
    if (Number.isFinite(ra) && ra > exponential) return ra;
  }
  return exponential;
}

async function readState(): Promise<BackoffState | null> {
  try {
    const raw = await cache.get(BACKOFF_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as BackoffState;
    if (typeof state.level !== "number" || !state.untilIso) return null;
    return state;
  } catch {
    return null; // fail open
  }
}

/** Throw before any upstream I/O while a hold-off window is active. */
export async function assertNotInBackoff(): Promise<void> {
  const state = await readState();
  if (state && new Date(state.untilIso).getTime() > Date.now()) {
    throw new Error(UPSTREAM_BACKOFF_ERROR);
  }
}

/** Record a 429/5xx/timeout: escalate the level and open a hold-off window. */
export async function recordUpstreamFailure(retryAfter: string | null): Promise<void> {
  try {
    const prev = await readState();
    const level = (prev?.level ?? 0) + 1;
    const delay = computeBackoffDelaySeconds(level, retryAfter);
    const state: BackoffState = {
      level,
      untilIso: new Date(Date.now() + delay * 1000).toISOString(),
    };
    await cache.set(BACKOFF_KEY, JSON.stringify(state), STATE_TTL_SECONDS);
    console.warn(`[upstream-backoff] level=${level} holding off ${delay}s${retryAfter ? ` (Retry-After=${retryAfter})` : ""}`);
  } catch { /* best-effort */ }
}

/** Half-open reset: clear the state only once the hold-off has elapsed. */
export async function recordUpstreamSuccess(): Promise<void> {
  try {
    const state = await readState();
    if (!state) return;
    if (new Date(state.untilIso).getTime() <= Date.now()) {
      await cache.del(BACKOFF_KEY);
    }
  } catch { /* best-effort */ }
}
