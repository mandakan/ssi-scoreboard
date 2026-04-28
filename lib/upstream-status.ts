// Server-only — short-lived signal that the upstream SSI GraphQL API is
// failing. Set from the catch blocks in `refreshCachedQuery` /
// `refreshCachedMatchQuery` and from /api/events on browse failures.
// Read by handlers that decorate `cacheInfo.upstreamDegraded` on responses
// and by /api/upstream-status (which the homepage banner polls).
//
// Storage: a single Redis key with a 60s TTL. The key is process-wide
// (not per match) — any failed refresh marks the system as "degraded" for
// the next minute, which matches the user's mental model: "scores aren't
// updating right now".

import cache from "@/lib/cache-impl";
import { upstreamTelemetry, type DegradedSite } from "@/lib/upstream-telemetry";

export const UPSTREAM_DEGRADED_KEY = "upstream:lastFailureAt";
export const UPSTREAM_DEGRADED_TTL_SECONDS = 60;

/** Mark the upstream as degraded for the next ~60s. Fire-and-forget. The
 *  `site` is required so telemetry can attribute prolonged degraded stretches
 *  to the right call site (events route vs. SWR refresh) without us having
 *  to grep through stack traces. */
export async function markUpstreamDegraded(
  site: DegradedSite,
  errorClass: string | null = null,
): Promise<void> {
  upstreamTelemetry({ op: "degraded-marked", site, errorClass });
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
