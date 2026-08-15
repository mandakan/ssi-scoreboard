// Per-isolate FIFO semaphore for outbound SSI GraphQL calls.
//
// Added after the 2026-08-15 SSI CPU-overload incident: SSI asked us to keep
// concurrent GraphQL requests at 1-2. This bounds concurrency per worker
// isolate; cross-isolate coordination comes from the Redis single-flight
// locks (`inflight:{cacheKey}`) and the shared backoff gate in
// lib/upstream-backoff.ts. Together those three are the effective governor —
// do not describe this semaphore alone as a global cap.
//
// The JWT fetches in lib/ssi-auth.ts intentionally do NOT take a slot: they
// run while executeQueryOnce already holds one, so acquiring here would
// deadlock at limit 1. They are rare and Redis-single-flighted on their own.

interface Waiter {
  resolve: () => void;
}

let inFlight = 0;
const queue: Waiter[] = [];

function maxConcurrency(): number {
  const raw = process.env.UPSTREAM_MAX_CONCURRENCY;
  if (raw == null) return 2;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function release(): void {
  inFlight--;
  const next = queue.shift();
  if (next) {
    inFlight++;
    next.resolve();
  }
}

async function acquire(): Promise<void> {
  if (inFlight < maxConcurrency()) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => {
    queue.push({ resolve });
  });
}

/**
 * Run `fn` while holding an upstream slot. Callers should start their own
 * request timeout INSIDE `fn` — time spent queueing here must not count
 * against the upstream fetch timeout.
 */
export async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test/diagnostics hook. */
export function upstreamLimiterStats(): { inFlight: number; queued: number } {
  return { inFlight, queued: queue.length };
}
