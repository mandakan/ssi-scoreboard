// Server-only -- shared auth, rate-limit, and error helpers for /api/v1/*.
//
// The v1 namespace is the stable contract for external consumers (currently
// splitsmith). Internal browser routes under /api/* keep their existing
// unauthenticated, IP-based rate limiting. /api/v1/* serves the same public
// data without a token (rate-limited per client IP); a bearer from
// EXTERNAL_API_TOKENS identifies a consumer and moves it to its own,
// higher per-token bucket (#554). A present-but-invalid bearer is still a
// 401 so a typo never silently downgrades a consumer to anonymous.
//
// Error envelope: { "error": { "code": string, "message": string } }
// Documented codes: unauthorized, rate_limited, not_found, upstream_failed,
// bad_request.
//
// See docs/api-v1.md for the full contract.

import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { getClientIp, runWithIpRateLimitSkipped } from "@/lib/rate-limit";

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
 * Who is calling a v1 endpoint. Token callers are identified by their bearer
 * (validated against EXTERNAL_API_TOKENS); everyone else is anonymous and
 * identified by client IP. The rate limiter keys its bucket on this.
 */
export type V1Caller =
  | { kind: "token"; token: string }
  | { kind: "anonymous"; ip: string };

/**
 * Resolve the caller identity on a v1 request.
 *
 * - No Authorization header -> anonymous caller keyed by client IP. Works
 *   even when EXTERNAL_API_TOKENS is unset (that only means "no elevated
 *   consumers", not "closed").
 * - A present header must be a valid `Bearer <token>` from
 *   EXTERNAL_API_TOKENS, otherwise 401. An invalid or malformed header is
 *   never downgraded to anonymous, so a misconfigured consumer notices.
 */
export function authenticateV1Request(req: Request): V1Caller | NextResponse {
  const header = req.headers.get("Authorization");
  if (header === null) {
    return { kind: "anonymous", ip: getClientIp(req) };
  }
  if (!header.startsWith("Bearer ")) {
    return v1Error(
      "unauthorized",
      "Malformed Authorization header (expected 'Bearer <token>'); omit it for anonymous access",
      401,
    );
  }
  const token = header.slice("Bearer ".length).trim();
  const tokens = parseExternalApiTokens();
  if (!token || !tokens.has(token)) {
    return v1Error("unauthorized", "Invalid bearer token", 401);
  }
  return { kind: "token", token };
}

/** Default per-token rate limit (requests per minute). Override with EXTERNAL_API_RATE_LIMIT_PER_MIN. */
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
/** Default anonymous (per-IP) rate limit. Matches the internal IP limiter. Override with EXTERNAL_API_ANON_RATE_LIMIT_PER_MIN. */
const DEFAULT_ANON_RATE_LIMIT_PER_MIN = 30;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function getRateLimitPerMin(caller: V1Caller): number {
  return caller.kind === "token"
    ? readPositiveIntEnv("EXTERNAL_API_RATE_LIMIT_PER_MIN", DEFAULT_RATE_LIMIT_PER_MIN)
    : readPositiveIntEnv("EXTERNAL_API_ANON_RATE_LIMIT_PER_MIN", DEFAULT_ANON_RATE_LIMIT_PER_MIN);
}

/**
 * Fixed-window rate limiter backed by the cache adapter, keyed per caller.
 *
 * Token callers bucket on a stable hash of the token so the raw secret never
 * lands in Redis (limit: EXTERNAL_API_RATE_LIMIT_PER_MIN, default 60).
 * Anonymous callers bucket on client IP under a separate `anon:` prefix
 * (limit: EXTERNAL_API_ANON_RATE_LIMIT_PER_MIN, default 30), so a token
 * caller and an anonymous caller sharing an IP never share a bucket.
 * Window is 60 seconds.
 *
 * Fails open on cache errors -- a degraded Redis must not lock external
 * consumers out, the same posture as lib/rate-limit.ts for internal routes.
 */
export async function checkV1RateLimit(
  caller: V1Caller,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const limit = getRateLimitPerMin(caller);
  const windowSeconds = 60;
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const bucket =
    caller.kind === "token" ? await hashToken(caller.token) : `anon:${caller.ip}`;
  const key = `rl:v1:${bucket}:${window}`;

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
 * Combined gate: resolve the caller, then rate-limit. Returns the caller on
 * success or the appropriate NextResponse on failure. Use at the top of
 * every v1 route handler.
 */
export async function gateV1Request(req: Request): Promise<V1Caller | NextResponse> {
  const auth = authenticateV1Request(req);
  if (auth instanceof NextResponse) return auth;
  const rl = await checkV1RateLimit(auth);
  if (!rl.allowed) {
    return v1Error("rate_limited", "Rate limit exceeded", 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }
  return auth;
}

/**
 * Forward to an internal route handler with the IP-based rate limit bypassed.
 * The v1 surface enforces its own per-caller bucket; double-counting against
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
