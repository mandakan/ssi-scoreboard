// Server-only — sliding window rate limiter backed by the cache adapter.
// Uses a simple fixed-window counter per IP + route (one cache key per window).
// Fails open: if the cache is unavailable, the request is allowed through.

import { AsyncLocalStorage } from "node:async_hooks";
import cache from "@/lib/cache-impl";

// Async-local flag set by /api/v1/* wrappers when they forward to an internal
// route. The v1 surface enforces its own per-token bucket (lib/api-v1.ts), so
// the inner IP-based limit must not also fire — otherwise the consumer's
// effective rate is the *minimum* of the two, defeating the documented v1
// limit. The flag is request-scoped via AsyncLocalStorage; external clients
// cannot set it because there is no header that maps to it.
const skipStorage = new AsyncLocalStorage<true>();

/**
 * Run `fn` with the IP-based rate limit suppressed. Used by /api/v1/* wrappers
 * which apply per-token rate limiting before forwarding to the internal route.
 */
export function runWithIpRateLimitSkipped<T>(fn: () => T): T {
  return skipStorage.run(true, fn);
}

interface RateLimitOptions {
  /** Unique prefix for the rate limit bucket (e.g. "events", "compare"). */
  prefix: string;
  /** Maximum number of requests per window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

/**
 * Extract client IP from request headers.
 * Checks CF-Connecting-IP (Cloudflare), X-Forwarded-For (reverse proxy),
 * then falls back to a generic key.
 */
function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Check and increment the rate limit counter for a request.
 * Returns { allowed: true } if under the limit, or { allowed: false, retryAfter }
 * with the number of seconds until the window resets.
 *
 * Fails open: cache errors result in { allowed: true }.
 */
export async function checkRateLimit(
  req: Request,
  opts: RateLimitOptions,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  if (skipStorage.getStore()) return { allowed: true };
  const ip = getClientIp(req);
  const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
  const key = `rl:${opts.prefix}:${ip}:${window}`;

  try {
    const current = await cache.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= opts.limit) {
      const windowEnd = (window + 1) * opts.windowSeconds;
      const retryAfter = windowEnd - Math.floor(Date.now() / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    // Increment counter. Set TTL to windowSeconds so it auto-expires.
    await cache.set(key, String(count + 1), opts.windowSeconds);
    return { allowed: true };
  } catch {
    // Fail open — don't block requests if cache is unavailable
    return { allowed: true };
  }
}
