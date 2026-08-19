// Adaptive idle cadence for the per-match sync probe (#503).
//
// Live matches spend most of their wall-clock idle (squad rotations, lunch,
// overnight in status "on"). Probing every 60s all that time is our dominant
// steady-state upstream cost. After IDLE_STREAK consecutive no-change cycles
// the probe holds off 120s; after DEEP_IDLE_STREAK cycles, 300s. Any detected
// change deletes the state, snapping straight back to the 60s base cadence.
//
// State is one Redis key per match, best-effort in both directions: cache
// down -> probe as normal (fail open). Both the match-key and scorecards-key
// refreshes report outcomes each cycle; a 30s bump guard counts them as one.

import cache from "@/lib/cache-impl";
import { withJitter } from "@/lib/jitter";

const IDLE_STREAK = 5;            // ~5 quiet minutes at the 60s base cadence
const IDLE_DELAY_SECONDS = 120;
const DEEP_IDLE_STREAK = 8;
const DEEP_IDLE_DELAY_SECONDS = 300;
const BUMP_GUARD_MS = 30_000;
const STATE_TTL_SECONDS = 3600;

export function probeCadenceKey(ct: number, id: string): string {
  return `probe:idle:${ct}:${id}`;
}

interface IdleState {
  streak: number;
  lastBumpAtIso: string;
  notBeforeIso: string | null;
}

async function readState(key: string): Promise<IdleState | null> {
  try {
    const raw = await cache.get(key);
    return raw ? (JSON.parse(raw) as IdleState) : null;
  } catch {
    return null; // fail open
  }
}

/** False while an idle hold-off window is active — skip the probe, just
 *  extend TTLs. Fail-open: no state or cache trouble means "probe". */
export async function shouldProbeNow(ct: number, id: string): Promise<boolean> {
  const state = await readState(probeCadenceKey(ct, id));
  if (!state?.notBeforeIso) return true;
  return new Date(state.notBeforeIso).getTime() <= Date.now();
}

/** Report a probe cycle's outcome. Change -> reset to base cadence.
 *  No change -> extend the quiet streak (once per cycle) and set the
 *  hold-off when past the idle thresholds. */
export async function recordProbeOutcome(ct: number, id: string, changed: boolean): Promise<void> {
  const key = probeCadenceKey(ct, id);
  try {
    if (changed) {
      await cache.del(key);
      return;
    }
    const prev = await readState(key);
    if (prev && Date.now() - new Date(prev.lastBumpAtIso).getTime() < BUMP_GUARD_MS) {
      return; // the other cache key's refresh already counted this cycle
    }
    const streak = (prev?.streak ?? 0) + 1;
    const delaySeconds =
      streak >= DEEP_IDLE_STREAK ? DEEP_IDLE_DELAY_SECONDS
        : streak >= IDLE_STREAK ? IDLE_DELAY_SECONDS
        : null;
    const state: IdleState = {
      streak,
      lastBumpAtIso: new Date().toISOString(),
      // 20-30% jitter (SSI ask 2026-08-18) so instances don't re-probe in sync.
      notBeforeIso: delaySeconds ? new Date(Date.now() + withJitter(delaySeconds) * 1000).toISOString() : null,
    };
    await cache.set(key, JSON.stringify(state), STATE_TTL_SECONDS);
  } catch { /* best-effort */ }
}
