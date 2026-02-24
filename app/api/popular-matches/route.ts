import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import type { PopularMatch } from "@/lib/types";


/** Maximum time (seconds) since last access to qualify as "popular". */
const MAX_IDLE_SECONDS = 14 * 24 * 60 * 60; // 14 days

/** Maximum number of results to return. */
const MAX_RESULTS = 8;

/** Key prefix used by cachedExecuteQuery for GetMatch calls. */
const KEY_PREFIX = "gql:GetMatch:";

interface RawMatchEvent {
  name: string;
  venue?: string | null;
  starts?: string | null;
  scoring_completed?: string | number | null;
}

interface MatchCacheEntry {
  data: { event: RawMatchEvent | null };
  cachedAt: string;
}

/**
 * GET /api/popular-matches
 *
 * Scans the cache for recently-accessed match keys (gql:GetMatch:*) and
 * returns up to 8 matches accessed within the last 14 days, sorted by
 * most-recently-accessed first.
 *
 * Returns [] when the cache adapter doesn't support idle-time scanning
 * (e.g. Cloudflare edge deployment) or on any cache error.
 */
export async function GET() {
  try {
    const recentKeys = await cache.scanRecentKeys(KEY_PREFIX, MAX_IDLE_SECONDS);

    if (recentKeys.length === 0) {
      return NextResponse.json([] as PopularMatch[]);
    }

    const results: PopularMatch[] = [];
    for (const { key } of recentKeys) {
      if (results.length >= MAX_RESULTS) break;
      try {
        const raw = await cache.get(key);
        if (!raw) continue;

        const entry = JSON.parse(raw) as MatchCacheEntry;
        if (!entry.data?.event) continue;

        // Key format: gql:GetMatch:{"ct":22,"id":"26547"}
        const vars = JSON.parse(key.slice(KEY_PREFIX.length)) as {
          ct: number;
          id: string;
        };

        const ev = entry.data.event;
        results.push({
          ct: String(vars.ct),
          id: vars.id,
          name: ev.name,
          venue: ev.venue ?? null,
          date: ev.starts ?? null,
          scoring_completed:
            ev.scoring_completed != null
              ? Math.round(parseFloat(String(ev.scoring_completed)))
              : 0,
        });
      } catch {
        // Skip malformed entries.
      }
    }

    return NextResponse.json(results);
  } catch {
    // Cache unavailable — return empty list (graceful degradation).
    return NextResponse.json([] as PopularMatch[]);
  }
}
