import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { gqlCacheKey } from "@/lib/graphql";


// DELETE /api/admin/cache/purge?ct=22&id=<match-id>
// Requires Authorization: Bearer <CACHE_PURGE_SECRET>
export async function DELETE(req: Request) {
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

  const matchKey = gqlCacheKey("GetMatch", { ct: ctNum, id });
  const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
  const matchGlobalKey = `computed:matchglobal:${ctNum}:${id}`;

  // Delete from both Redis and D1/SQLite
  await Promise.all([
    cache.del(matchKey, scorecardsKey, matchGlobalKey),
    db.deleteMatchDataCache(matchKey, scorecardsKey, matchGlobalKey),
  ]);

  return NextResponse.json({ purged: [matchKey, scorecardsKey, matchGlobalKey] });
}
