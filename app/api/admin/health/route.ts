import { NextResponse } from "next/server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import cache from "@/lib/cache-impl";
import { buildDashboard, type DashboardData, type R2Bucket } from "@/lib/admin-health";

const CACHE_KEY = "admin:health:rollup";
const CACHE_TTL_SECONDS = 60;

interface CFEnvWithBucket {
  TELEMETRY_BUCKET?: R2Bucket;
}

/**
 * GET /api/admin/health?token=...
 *
 * Builds an aggregated dashboard view (last 1h / 24h windows) of the telemetry
 * Parquet files written by the Pipelines stream. Returns JSON. Result is
 * cached for 60s so repeat opens of the bookmarked dashboard URL are cheap.
 *
 * Auth: ?token=<ADMIN_DASHBOARD_TOKEN> in the query string. Token-in-URL is
 * deliberate so the dashboard is mobile-bookmarkable; treat the URL like a
 * shared secret.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const provided = url.searchParams.get("token");
  const expected = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refresh = url.searchParams.get("refresh") === "1";
  if (!refresh) {
    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DashboardData;
        return NextResponse.json({ ...parsed, cache: "hit" });
      } catch {
        // fall through to recompute
      }
    }
  }

  const { env } = getCloudflareContext() as unknown as { env: CFEnvWithBucket };
  const bucket = env?.TELEMETRY_BUCKET;
  if (!bucket) {
    return NextResponse.json(
      { error: "TELEMETRY_BUCKET binding missing" },
      { status: 500 },
    );
  }

  const data = await buildDashboard(bucket);
  await cache.set(CACHE_KEY, JSON.stringify(data), CACHE_TTL_SECONDS);
  return NextResponse.json({ ...data, cache: refresh ? "bypass" : "miss" });
}
