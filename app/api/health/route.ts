import { NextResponse } from "next/server";

// Public liveness endpoint. Intentionally lightweight: no Redis / D1 / GraphQL
// calls, no auth. Used by uptime probes, load balancers, and CI smoke checks.
//
// Deep readiness checks (cache round-trip, env-var presence) live behind auth
// at /api/admin/cache/health -- exposing them publicly would amplify load on
// our backends and leak operational detail.
//
// Response shape follows the IETF "Health Check Response Format for HTTP APIs"
// draft (draft-inadarei-api-health-check): status / version / releaseId /
// serviceId / description, served as application/health+json.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICE_ID = "ssi-scoreboard";
const DESCRIPTION = "SSI Scoreboard liveness probe";
const API_VERSION = "1";

function buildPayload() {
  return {
    status: "pass" as const,
    version: API_VERSION,
    releaseId: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
    serviceId: SERVICE_ID,
    description: DESCRIPTION,
  };
}

const HEALTH_HEADERS = {
  "Content-Type": "application/health+json",
  "Cache-Control": "no-store",
} as const;

export async function GET(): Promise<Response> {
  return NextResponse.json(buildPayload(), { headers: HEALTH_HEADERS });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200, headers: HEALTH_HEADERS });
}
