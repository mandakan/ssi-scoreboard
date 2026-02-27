import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import type { PopularMatch } from "@/lib/types";

/** Maximum age (seconds) a match access must be within to qualify. */
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 days

/** Maximum number of results to return. */
const MAX_RESULTS = 24;

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
 * Returns up to 24 matches that have been accessed within the last 14 days,
 * sorted by access frequency (most-accessed first).
 *
 * Popularity is tracked via two Redis sorted sets written by cachedExecuteQuery
 * on every GetMatch cache hit or fresh fetch:
 *   popular:matches:seen  — score = Unix timestamp of last access
 *   popular:matches:hits  — score = cumulative access count
 *
 * Works on both the ioredis (Docker/Node) and @upstash/redis (Cloudflare)
 * cache adapters. Returns [] on any cache error.
 */
export async function GET() {
  try {
    const popular = await cache.getPopularKeys(MAX_AGE_SECONDS, MAX_RESULTS);

    if (popular.length === 0) {
      return NextResponse.json([] as PopularMatch[]);
    }

    const results: PopularMatch[] = [];
    for (const { key } of popular) {
      if (results.length >= MAX_RESULTS) break;
      try {
        const raw = await cache.get(key);
        if (!raw) continue;

        const entry = JSON.parse(raw) as MatchCacheEntry;
        if (!entry.data?.event) continue;

        // Key format: gql:GetMatch:{"ct":22,"id":"26547"}
        const vars = JSON.parse(key.slice("gql:GetMatch:".length)) as {
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
