// Server-only — short-lived signal that the upstream SSI GraphQL API is
// failing. Set from the catch block in `refreshCachedQuery`; read by handlers
// that decorate `cacheInfo.upstreamDegraded` on responses.
//
// Storage: a single Redis key with a 60s TTL. The key is process-wide
// (not per match) — any failed refresh marks the system as "degraded" for
// the next minute, which matches the user's mental model: "scores aren't
// updating right now".

import cache from "@/lib/cache-impl";

export const UPSTREAM_DEGRADED_KEY = "upstream:lastFailureAt";
export const UPSTREAM_DEGRADED_TTL_SECONDS = 60;

/** Mark the upstream as degraded for the next ~60s. Fire-and-forget. */
export async function markUpstreamDegraded(): Promise<void> {
  try {
    await cache.set(
      UPSTREAM_DEGRADED_KEY,
      new Date().toISOString(),
      UPSTREAM_DEGRADED_TTL_SECONDS,
    );
  } catch { /* cache may be down — degraded state is best-effort */ }
}

/** Returns true if the upstream has failed within the last ~60s. */
export async function isUpstreamDegraded(): Promise<boolean> {
  try {
    const v = await cache.get(UPSTREAM_DEGRADED_KEY);
    return v != null;
  } catch {
    return false;
  }
}
