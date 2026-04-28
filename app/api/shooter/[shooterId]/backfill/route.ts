/**
 * POST /api/shooter/{shooterId}/backfill
 *
 * Scans all cached match data in Redis to find matches the shooter competed
 * in but that haven't been indexed yet. This is a pure cache read — no
 * GraphQL API calls are made. Returns a BackfillProgress summary.
 *
 * Scope: only matches that have been viewed by someone on this app (and are
 * therefore in Redis) can be discovered. Matches never opened by any user
 * are invisible to this endpoint. For those, use the add-match endpoint or
 * run warm-cache.ts to populate the cache first.
 *
 * Rate limited: 60s cooldown per shooter.
 */
import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { runBackfill } from "@/lib/backfill";
import { getMatchDataWithFallback } from "@/lib/match-data-store";
import { reportError } from "@/lib/error-telemetry";
import type { BackfillDeps } from "@/lib/backfill";
import type { BackfillProgress } from "@/lib/types";

/** Cooldown between backfill runs for the same shooter (seconds). */
const COOLDOWN_SECONDS = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const { shooterId: shooterIdStr } = await params;
  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return NextResponse.json({ error: "Invalid shooterId" } as const, { status: 400 });
  }

  // GDPR suppression check
  try {
    if (await db.isShooterSuppressed(shooterId)) {
      return NextResponse.json(
        { error: "This profile has been removed at the owner's request" } as const,
        { status: 410 },
      );
    }
  } catch (err) {
    reportError("backfill.suppression-check", err, { shooterId });
  }

  // Cooldown check
  const lockKey = `backfill:lock:${shooterId}`;
  try {
    const existing = await cache.get(lockKey);
    if (existing) {
      const result: BackfillProgress = {
        status: "complete",
        totalCached: 0,
        checked: 0,
        discovered: 0,
        alreadyIndexed: 0,
        errorMessage: "Backfill ran recently. Please wait a minute before scanning again.",
      };
      return NextResponse.json(result);
    }
  } catch (err) {
    reportError("backfill.cooldown-check", err, { shooterId });
  }

  // Wire up dependencies to real cache adapter + D1 fallback
  const deps: BackfillDeps = {
    async scanCachedMatchKeys() {
      // Union of Redis keys and D1 keys for maximum coverage
      const [redisKeys, d1Keys] = await Promise.all([
        cache.scanCachedMatchKeys(),
        db.scanMatchDataCacheKeys("match"),
      ]);
      const allKeys = new Set(redisKeys);
      for (const k of d1Keys) allKeys.add(k);
      return [...allKeys];
    },
    getCachedMatch: (key) => getMatchDataWithFallback(key),
    async getExistingMatchRefs(sid) {
      const refs = await db.getShooterMatches(sid);
      return new Set(refs);
    },
    async indexMatch({ shooterId: sid, ct, matchId, startTimestamp, competitor }) {
      const matchRef = `${ct}:${matchId}`;
      const lastSeen = new Date().toISOString();
      await db.indexShooterMatch(sid, matchRef, startTimestamp);
      await db.setShooterProfile(sid, {
        name: competitor.name,
        club: competitor.club,
        division: competitor.division,
        lastSeen,
        region: competitor.region,
        region_display: competitor.region_display,
        category: competitor.category,
        ics_alias: competitor.ics_alias,
        license: competitor.license,
      });
      // Invalidate dashboard cache
      await cache.del(`computed:shooter:${sid}:dashboard`);
    },
  };

  const result = await runBackfill(deps, { shooterId });

  // Set cooldown lock
  try {
    await cache.set(lockKey, "1", COOLDOWN_SECONDS);
  } catch (err) {
    reportError("backfill.cooldown-write", err, { shooterId });
  }

  console.log(
    JSON.stringify({
      route: "shooter-backfill",
      shooterId,
      totalCached: result.totalCached,
      discovered: result.discovered,
      alreadyIndexed: result.alreadyIndexed,
    }),
  );

  return NextResponse.json(result);
}
