// Admin-only endpoint: list match cache entries with metadata.
// Auth: Authorization: Bearer <CACHE_PURGE_SECRET>

import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

interface MatchMeta {
  ct: number;
  matchId: string;
  name: string;
  date: string | null;
  level: string | null;
  region: string | null;
  competitorCount: number;
  stageCount: number;
  scoringCompleted: number;
  storedAt: string;
  hasScorecards: boolean;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  const wantScorecards = req.nextUrl.searchParams.get("hasScorecard") === "true";

  // Load match entries (with data) and scorecard index in parallel.
  // includeData avoids N+1 queries — all data comes from a single D1/SQLite query.
  const [matchEntries, scorecardEntries] = await Promise.all([
    db.listMatchCacheEntries({ keyType: "match", since, includeData: true }),
    db.listMatchCacheEntries({ keyType: "scorecards" }),
  ]);

  const scorecardSet = new Set(
    scorecardEntries.map((e) => `${e.ct}:${e.matchId}`),
  );

  const matches: MatchMeta[] = [];

  for (const entry of matchEntries) {
    const matchKey = `${entry.ct}:${entry.matchId}`;
    const hasScorecards = scorecardSet.has(matchKey);

    if (wantScorecards && !hasScorecards) continue;
    if (!entry.data) continue;

    try {
      const parsed = JSON.parse(entry.data) as {
        v?: number;
        data?: {
          event?: {
            name?: string;
            starts?: string | null;
            level?: string | null;
            region?: string | null;
            competitors_count?: number;
            stages_count?: number;
            scoring_completed?: string | number | null;
          } | null;
        };
      };

      // Skip entries with outdated schema
      if (parsed.v !== CACHE_SCHEMA_VERSION) continue;

      const ev = parsed.data?.event;
      if (!ev) continue;

      matches.push({
        ct: entry.ct,
        matchId: entry.matchId,
        name: ev.name ?? "Unknown",
        date: ev.starts ?? null,
        level: ev.level ?? null,
        region: ev.region ?? null,
        competitorCount: ev.competitors_count ?? 0,
        stageCount: ev.stages_count ?? 0,
        scoringCompleted: Math.round(
          parseFloat(String(ev.scoring_completed ?? 0)),
        ),
        storedAt: entry.storedAt,
        hasScorecards,
      });
    } catch {
      // Skip entries with invalid JSON
    }
  }

  return NextResponse.json({ matches });
}
