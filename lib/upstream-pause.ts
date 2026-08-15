// Emergency kill switch for ALL outbound traffic to the SSI GraphQL API.
//
// When `SSI_UPSTREAM_PAUSED` is set (any value except "", "off", "0", "false"),
// every upstream call — data queries in lib/graphql.ts and the JWT
// token_auth/refresh_token mutations in lib/ssi-auth.ts — throws before the
// fetch is issued. Cached data keeps being served via the existing
// stale-on-error paths (refreshCachedQuery / refreshCachedMatchQuery extend
// TTLs on refresh failure), and handlers surface the degraded-upstream banner.
//
// Set/unset without a code deploy:
//   wrangler secret put SSI_UPSTREAM_PAUSED      # value: "on"
//   wrangler secret delete SSI_UPSTREAM_PAUSED
//
// Added 2026-08-15 after our request volume contributed to an outage of
// shootnscoreit.com during a live match.

// This message surfaces verbatim in client-facing 502 bodies (match pages,
// event search), so it is written for end users. Operators can grep for
// "temporarily paused" or check the SSI_UPSTREAM_PAUSED secret directly.
export const UPSTREAM_PAUSED_ERROR =
  "Live score updates are temporarily paused while we work with ShootNScoreIt. Saved results are still available.";

export function isSsiUpstreamPaused(): boolean {
  const raw = process.env.SSI_UPSTREAM_PAUSED;
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v !== "" && v !== "off" && v !== "0" && v !== "false";
}

/** Throw if the pause switch is engaged. Call before any outbound SSI fetch. */
export function assertSsiUpstreamAllowed(): void {
  if (isSsiUpstreamPaused()) {
    throw new Error(UPSTREAM_PAUSED_ERROR);
  }
}
