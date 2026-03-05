// Server-only — never import from client components or files with "use client".
// Utilities for decoding ShooterNode Relay Global IDs and building the
// cross-match shooter → match secondary Redis index.

import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";

/**
 * Decodes a Relay Global ID to extract the numeric ShooterNode primary key.
 *
 * The SSI GraphQL API uses Relay-style base64 Global IDs:
 *   base64("ShooterNode:41643") → "U2hvb3Rlck5vZGU6NDE2NDM="
 *
 * This ID is globally stable — the same physical shooter has the same
 * shooterId across all matches, even when their display name changes.
 *
 * Returns null if the ID is missing, malformed, or not a ShooterNode.
 */
export function decodeShooterId(relayId: string | null | undefined): number | null {
  if (!relayId) return null;
  try {
    const decoded = Buffer.from(relayId, "base64").toString("utf8");
    const match = /^ShooterNode:(\d+)$/.exec(decoded);
    if (!match) return null;
    const id = parseInt(match[1], 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

export interface ShooterProfile {
  name: string;
  club: string | null;
  division: string | null;
  lastSeen: string; // ISO timestamp
  region: string | null;
  region_display: string | null;
  category: string | null;
  ics_alias: string | null;
  license: string | null;
}

/**
 * Build shooter → match secondary index in the AppDatabase.
 *
 * For each competitor with a known shooterId, upserts:
 *   shooter_profiles   — name, club, division, lastSeen
 *   shooter_matches    — matchRef + startTimestamp
 *
 * Both operations are idempotent. Returns a Promise so the caller can
 * register it with ctx.waitUntil() on CF Workers (see lib/background-impl.ts),
 * ensuring writes complete even after the HTTP response is sent. Errors are
 * silently swallowed — this is non-fatal and must not affect the main request path.
 */
export function indexMatchShooters(
  ct: string,
  matchId: string,
  matchStart: string | null,
  competitors: Array<{
    shooterId: number | null;
    name: string;
    club: string | null;
    division: string | null;
    region?: string | null;
    region_display?: string | null;
    category?: string | null;
    ics_alias?: string | null;
    license?: string | null;
  }>,
): Promise<void> {
  const matchRef = `${ct}:${matchId}`;
  const startTimestamp = matchStart
    ? Math.floor(new Date(matchStart).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const lastSeen = new Date().toISOString();

  const writes: Promise<void>[] = [];
  for (const c of competitors) {
    if (c.shooterId == null) continue;
    const { shooterId } = c;
    const profile: ShooterProfile = {
      name: c.name,
      club: c.club,
      division: c.division,
      lastSeen,
      region: c.region ?? null,
      region_display: c.region_display ?? null,
      category: c.category ?? null,
      ics_alias: c.ics_alias ?? null,
      license: c.license ?? null,
    };
    writes.push(
      db.indexShooterMatch(shooterId, matchRef, startTimestamp).catch(() => {}),
      db.setShooterProfile(shooterId, profile).catch(() => {}),
      // Invalidate the pre-computed dashboard cache so the next visit picks up
      // this newly indexed match immediately rather than serving stale data.
      cache.del(`computed:shooter:${shooterId}:dashboard`).catch(() => {}),
    );
  }
  return Promise.allSettled(writes).then(() => {});
}
