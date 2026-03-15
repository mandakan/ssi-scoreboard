import { NextResponse } from "next/server";
import db from "@/lib/db-impl";

/** Default retention period: 2 years (in days). */
const DEFAULT_RETENTION_DAYS = 730;

/**
 * POST /api/admin/retention
 * Purges shooter profiles inactive for longer than the retention period.
 * Requires Authorization: Bearer <CACHE_PURGE_SECRET>
 *
 * Optional query param: ?days=730 (override retention period)
 *
 * Does NOT purge suppressed shooters — those are kept for GDPR compliance.
 */
export async function POST(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysParam = searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : DEFAULT_RETENTION_DAYS;
  if (isNaN(days) || days < 1) {
    return NextResponse.json({ error: "Invalid days parameter" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const purged = await db.purgeInactiveShooters(cutoff);

  console.log(JSON.stringify({
    route: "admin-retention",
    days,
    cutoff,
    purged,
  }));

  return NextResponse.json({ purged, days, cutoff });
}
