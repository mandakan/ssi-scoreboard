import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";

/**
 * GET /api/admin/cache/health
 * Requires: Authorization: Bearer <CACHE_PURGE_SECRET>
 *
 * Returns a diagnostic snapshot:
 *   - which env vars are present / missing
 *   - result of a live write→read→delete round-trip against the cache adapter
 *
 * Use this to verify Upstash connectivity from the deployed CF Worker:
 *   curl -H "Authorization: Bearer <secret>" https://<host>/api/admin/cache/health
 */
export async function GET(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  const env = {
    UPSTASH_REDIS_REST_URL: url
      ? `set (${url.slice(0, 40)}…)`
      : "MISSING",
    UPSTASH_REDIS_REST_TOKEN: token
      ? `set (length=${token.length})`
      : "MISSING",
    CACHE_PURGE_SECRET: secret ? "set" : "MISSING",
    SSI_API_KEY: process.env.SSI_API_KEY ? "set" : "MISSING",
  };

  // Live round-trip: write a probe key, read it back, then delete it.
  const probeKey = `health:probe:${Date.now()}`;
  const probeVal = `ok-${Date.now()}`;
  type PingStatus = "ok" | "write_failed" | "read_mismatch" | "error";
  let ping: PingStatus = "error";
  let pingError: string | null = null;
  let pingMs: number | null = null;

  const t0 = Date.now();
  try {
    await cache.set(probeKey, probeVal, 30);
    const readBack = await cache.get(probeKey);
    pingMs = Date.now() - t0;
    if (readBack === probeVal) {
      ping = "ok";
    } else {
      ping = "read_mismatch";
      pingError = `wrote "${probeVal}", read back "${readBack}"`;
    }
    await cache.del(probeKey);
  } catch (err) {
    pingMs = Date.now() - t0;
    ping = "error";
    pingError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    env,
    ping: { result: ping, error: pingError, latencyMs: pingMs },
  });
}
