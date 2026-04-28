import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { forceRefreshKey } from "@/lib/graphql";

// POST /api/admin/cache/force-refresh?ct=22&id=<match-id>
// Requires Authorization: Bearer <CACHE_PURGE_SECRET>
//
// Sets a `force-refresh:{ct}:{id}` Redis sentinel. The next probe-aware
// refresh (#361) for this match bypasses probe/delta logic entirely and does
// a clean full refetch of both GetMatch and GetMatchScorecards via the
// original `refreshCachedQuery` path. The sentinel is cleared automatically
// after a successful refresh.
//
// Use when you suspect the cached snapshot has been corrupted by a delta
// merge (#362) or when match.updated under-reported scorecard activity (#361).
// Faster than DELETE /purge because it doesn't require a full cold-cache
// refetch on the next user request — the next SWR cycle handles the refresh.
export async function POST(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const ct = searchParams.get("ct");
  const id = searchParams.get("id");
  if (!ct || !id) {
    return NextResponse.json({ error: "ct and id are required" }, { status: 400 });
  }

  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  // Sentinel auto-expires after 5 minutes — caps how long an unconsumed
  // sentinel can linger if no SWR cycle ever runs for this match.
  await cache.set(forceRefreshKey(ctNum, id), "1", 300);

  return NextResponse.json({
    forceRefreshSet: forceRefreshKey(ctNum, id),
    note: "Next SWR refresh for this match will bypass probe/delta and do a full refetch.",
  });
}
