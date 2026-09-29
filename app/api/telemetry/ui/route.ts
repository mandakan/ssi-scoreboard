import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  UI_TELEMETRY_MAX_BYTES,
  uiTelemetryEventSchema,
} from "@/lib/ui-telemetry-schema";
import { usageTelemetry } from "@/lib/usage-telemetry";

/**
 * POST /api/telemetry/ui
 *
 * Browser-sent UI interaction events (lib/ui-telemetry.ts, via sendBeacon).
 * Strict allowlist -- anything outside uiTelemetryEventSchema is a 400 and is
 * never logged. The rate limiter keys on IP in the cache only; the IP never
 * reaches the telemetry stream. Not reachable from MCP, so no maybeTagAsMcp.
 */
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, {
    prefix: "telemetry-ui",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const text = await req.text();
  if (text.length > UI_TELEMETRY_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = uiTelemetryEventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  usageTelemetry(parsed.data);
  return new NextResponse(null, { status: 204 });
}
