import { NextResponse } from "next/server";
import redis from "@/lib/redis";
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

interface KeyWithIdle {
  key: string;
  idleSeconds: number;
}

/**
 * GET /api/popular-matches
 *
 * Scans Redis for cached match keys (gql:GetMatch:*) and returns up to 8
 * matches that have been accessed within the last 14 days, sorted by most
 * recently accessed first.
 *
 * Returns [] on any Redis error (graceful degradation).
 */
export async function GET() {
  try {
    // 1. Collect all GetMatch cache keys via SCAN (cursor-based, safe for production).
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(
        cursor,
        "MATCH",
        `${KEY_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length === 0) {
      return NextResponse.json([] as PopularMatch[]);
    }

    // 2. Fetch idletime for all keys in parallel, then filter to those within 14 days.
    const idleResults = await Promise.all(
      keys.map(async (key): Promise<KeyWithIdle> => {
        try {
          const result = await redis.object("idletime", key);
          const idleSeconds = typeof result === "number" ? result : 0;
          return { key, idleSeconds };
        } catch {
          // OBJECT IDLETIME unsupported (e.g. some managed Redis configs) —
          // treat as idle=0 so the entry is included.
          return { key, idleSeconds: 0 };
        }
      }),
    );

    const recentKeys = idleResults
      .filter(({ idleSeconds }) => idleSeconds <= MAX_IDLE_SECONDS)
      .sort((a, b) => a.idleSeconds - b.idleSeconds); // lowest idle = most recent

    // 3. Fetch and parse cache entries for the top N keys.
    const results: PopularMatch[] = [];
    for (const { key } of recentKeys) {
      if (results.length >= MAX_RESULTS) break;
      try {
        const raw = await redis.get(key);
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
    // Redis unavailable — return empty list (graceful degradation).
    return NextResponse.json([] as PopularMatch[]);
  }
}
