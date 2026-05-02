// Server-only -- shared auth, rate-limit, and error helpers for /api/v1/*.
//
// The v1 namespace is the stable contract for external consumers (currently
// splitsmith). Internal browser routes under /api/* keep their existing
// unauthenticated, IP-based rate limiting; only /api/v1/* is gated by a
// bearer token from EXTERNAL_API_TOKENS and rate-limited per token.
//
// Error envelope: { "error": { "code": string, "message": string } }
// Documented codes: unauthorized, rate_limited, not_found, upstream_failed,
// bad_request.
//
// See docs/api-v1.md for the full contract.

import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { runWithIpRateLimitSkipped } from "@/lib/rate-limit";

export type V1ErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "upstream_failed"
  | "bad_request";

interface V1ErrorBody {
  error: { code: V1ErrorCode; message: string };
}

/** Build a v1 error response envelope. */
export function v1Error(
  code: V1ErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse<V1ErrorBody> {
  return NextResponse.json<V1ErrorBody>(
    { error: { code, message } },
    { status, headers: extraHeaders },
  );
}

/**
 * Parse EXTERNAL_API_TOKENS into a set of valid bearer tokens.
 *
 * Accepts comma-separated values and trims whitespace. Empty entries are
 * dropped, so `EXTERNAL_API_TOKENS=,abc, ,def,` yields {"abc", "def"}.
 *
 * Read on every call (not cached) so secret rotations via `wrangler secret put`
 * pick up without a code redeploy.
 */
export function parseExternalApiTokens(): Set<string> {
  const raw = process.env.EXTERNAL_API_TOKENS ?? "";
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t) out.add(t);
  }
  return out;
}

/**
 * Resolve and validate the bearer token on a v1 request.
 *
 * Returns the token string on success, or a NextResponse on failure (401).
 * If no tokens are configured, every request is rejected -- the v1 surface is
 * never accidentally open.
 */
export function authenticateV1Request(
  req: Request,
): { token: string } | NextResponse {
  const tokens = parseExternalApiTokens();
  if (tokens.size === 0) {
    return v1Error(
      "unauthorized",
      "EXTERNAL_API_TOKENS is not configured on this deployment",
      401,
    );
  }
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return v1Error(
      "unauthorized",
      "Missing or malformed Authorization header (expected 'Bearer <token>')",
      401,
    );
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token || !tokens.has(token)) {
    return v1Error("unauthorized", "Invalid bearer token", 401);
  }
  return { token };
}

/** Default per-token rate limit (requests per minute). Override with EXTERNAL_API_RATE_LIMIT_PER_MIN. */
const DEFAULT_RATE_LIMIT_PER_MIN = 60;

function getRateLimitPerMin(): number {
  const raw = process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN;
  if (!raw) return DEFAULT_RATE_LIMIT_PER_MIN;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE_LIMIT_PER_MIN;
  return n;
}

/**
 * Per-token fixed-window rate limiter backed by the cache adapter.
 *
 * Uses a stable hash of the token for the cache key so the raw secret never
 * lands in Redis. Window is 60 seconds; the limit comes from
 * EXTERNAL_API_RATE_LIMIT_PER_MIN (default 60).
 *
 * Fails open on cache errors -- a degraded Redis must not lock external
 * consumers out, the same posture as lib/rate-limit.ts for internal routes.
 */
export async function checkV1RateLimit(
  token: string,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const limit = getRateLimitPerMin();
  const windowSeconds = 60;
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const tokenKey = await hashToken(token);
  const key = `rl:v1:${tokenKey}:${window}`;

  try {
    const current = await cache.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= limit) {
      const windowEnd = (window + 1) * windowSeconds;
      const retryAfter = Math.max(1, windowEnd - Math.floor(Date.now() / 1000));
      return { allowed: false, retryAfter };
    }
    await cache.set(key, String(count + 1), windowSeconds);
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

// Hash the bearer token before composing a cache key so the raw secret never
// hits Redis logs or persistence dumps. SHA-256 hex truncated to 16 chars is
// plenty -- collisions across the small EXTERNAL_API_TOKENS set are negligible.
async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Combined gate: authenticate, then rate-limit. Returns the token on success
 * or the appropriate NextResponse on failure. Use at the top of every v1
 * route handler.
 */
export async function gateV1Request(
  req: Request,
): Promise<{ token: string } | NextResponse> {
  const auth = authenticateV1Request(req);
  if (auth instanceof NextResponse) return auth;
  const rl = await checkV1RateLimit(auth.token);
  if (!rl.allowed) {
    return v1Error("rate_limited", "Rate limit exceeded", 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }
  return auth;
}

/**
 * Forward to an internal route handler with the IP-based rate limit bypassed.
 * The v1 surface enforces its own per-token bucket; double-counting against
 * the internal IP bucket would defeat the documented v1 limit.
 */
export function forwardToInternal<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve(runWithIpRateLimitSkipped(fn));
}

/**
 * Map an internal route handler's response to the v1 contract.
 *
 * Internal routes use ad-hoc error shapes (`{ error: "string" }`); v1 wraps
 * them in the documented envelope based on HTTP status. Successful responses
 * (2xx) are returned unchanged so the caller sees the underlying contract.
 *
 * `notFoundCode` lets a route override the default 404 mapping (used when a
 * 404 means "match not found" vs "shooter not found", same code but different
 * message).
 */
export async function mapInnerToV1(
  inner: Response,
  opts: { notFoundMessage?: string; badRequestPrefix?: string } = {},
): Promise<Response> {
  if (inner.ok) {
    // Strip Server-Timing -- it leaks internal route latency labels and isn't
    // part of the documented contract. Everything else passes through.
    const headers = new Headers(inner.headers);
    headers.delete("Server-Timing");
    const body = await inner.text();
    return new Response(body, { status: inner.status, headers });
  }

  let upstreamMessage = `Upstream returned ${inner.status}`;
  try {
    const parsed = (await inner.clone().json()) as { error?: unknown };
    if (typeof parsed.error === "string") upstreamMessage = parsed.error;
  } catch {
    // Non-JSON body -- keep default message.
  }

  if (inner.status === 404) {
    return v1Error("not_found", opts.notFoundMessage ?? upstreamMessage, 404);
  }
  if (inner.status === 400) {
    return v1Error(
      "bad_request",
      opts.badRequestPrefix
        ? `${opts.badRequestPrefix}: ${upstreamMessage}`
        : upstreamMessage,
      400,
    );
  }
  if (inner.status === 410) {
    // Suppressed shooter -- treat as "not_found" from the consumer's POV; a
    // gone resource and a missing one are both "we have nothing for you".
    return v1Error("not_found", upstreamMessage, 410);
  }
  // 5xx and anything else: classify as upstream failure.
  return v1Error("upstream_failed", upstreamMessage, inner.status >= 500 ? 502 : inner.status);
}
