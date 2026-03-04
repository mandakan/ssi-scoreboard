import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { runBackfill } from "@/lib/backfill";
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
  } catch { /* ignore cache errors */ }

  // Wire up dependencies to real cache adapter
  const deps: BackfillDeps = {
    scanCachedMatchKeys: () => cache.scanCachedMatchKeys(),
    getCachedMatch: (key) => cache.get(key),
    async getExistingMatchRefs(sid) {
      const refs = await cache.getShooterMatches(sid);
      return new Set(refs);
    },
    async indexMatch({ shooterId: sid, ct, matchId, startTimestamp, competitor }) {
      const matchRef = `${ct}:${matchId}`;
      const lastSeen = new Date().toISOString();
      await cache.indexShooterMatch(sid, matchRef, startTimestamp);
      await cache.setShooterProfile(sid, JSON.stringify({
        name: competitor.name,
        club: competitor.club,
        division: competitor.division,
        lastSeen,
      }));
      // Invalidate dashboard cache
      await cache.del(`computed:shooter:${sid}:dashboard`);
    },
  };

  const result = await runBackfill(deps, { shooterId });

  // Set cooldown lock
  try {
    await cache.set(lockKey, "1", COOLDOWN_SECONDS);
  } catch { /* ignore */ }

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
