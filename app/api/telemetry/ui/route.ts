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
  // Beacons are CORS "simple requests" (no preflight), so any site could post
  // valid events and skew the baseline. Browsers mark those cross-site;
  // requests without the header (older browsers, curl) are let through.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > UI_TELEMETRY_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

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

  const text = await readCapped(req, UI_TELEMETRY_MAX_BYTES);
  if (text === null) {
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

/**
 * Read the body as UTF-8, stopping once it exceeds `maxBytes` so a chunked
 * or mis-declared body is never buffered in full. Returns null when over.
 */
async function readCapped(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
