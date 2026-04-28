import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { UPSTREAM_DEGRADED_KEY } from "@/lib/upstream-status";

// Always dynamic — must reflect the live degraded flag, not a build-time
// snapshot. Short response so polling at 60s is cheap.
export const dynamic = "force-dynamic";

interface UpstreamStatus {
  degraded: boolean;
  /** ISO timestamp of the most recent upstream failure, or null. */
  since: string | null;
}

/**
 * GET /api/upstream-status
 *
 * Returns whether the SSI GraphQL API has failed within the last ~60s. The
 * homepage uses this to surface a banner so users don't blame the scoreboard
 * when SSI is unreachable. Self-clears via the 60s TTL on the underlying
 * Redis key — no explicit "healthy" signal needed.
 */
export async function GET() {
  let since: string | null = null;
  try {
    since = (await cache.get(UPSTREAM_DEGRADED_KEY)) ?? null;
  } catch {
    // Cache may be down — degraded state is best-effort.
    since = null;
  }

  const body: UpstreamStatus = { degraded: since != null, since };
  return NextResponse.json(body, {
    // Don't CDN-cache: responses must reflect the live flag so a degraded
    // signal clears within ~60s of SSI recovering. Per-client polling
    // cadence is set on the TanStack Query side, not here.
    headers: { "Cache-Control": "no-store" },
  });
}
