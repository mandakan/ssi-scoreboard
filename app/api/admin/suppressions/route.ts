import { NextResponse } from "next/server";
import db from "@/lib/db-impl";

/**
 * GET /api/admin/suppressions
 * Returns all suppressed shooter IDs with timestamps.
 * Requires Authorization: Bearer <CACHE_PURGE_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suppressions = await db.listSuppressedShooters();
  return NextResponse.json(suppressions);
}

/**
 * DELETE /api/admin/suppressions?shooterId=<id>
 * Removes a shooter from the suppression list (unsuppress).
 * Requires Authorization: Bearer <CACHE_PURGE_SECRET>
 */
export async function DELETE(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const shooterIdStr = searchParams.get("shooterId");
  if (!shooterIdStr) {
    return NextResponse.json({ error: "shooterId is required" }, { status: 400 });
  }

  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return NextResponse.json({ error: "Invalid shooterId" }, { status: 400 });
  }

  await db.unsuppressShooter(shooterId);

  console.log(JSON.stringify({ route: "admin-unsuppress", shooterId }));

  return NextResponse.json({ unsuppressed: true, shooterId });
}
