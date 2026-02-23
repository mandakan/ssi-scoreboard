import { NextResponse } from "next/server";
import redis from "@/lib/redis";
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

  await redis.del(matchKey, scorecardsKey);

  return NextResponse.json({ purged: [matchKey, scorecardsKey] });
}
