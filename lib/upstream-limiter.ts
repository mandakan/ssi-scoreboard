// Concurrency governor for outbound SSI GraphQL calls.
//
// Two layers (SSI asks, 2026-08-15 incident + 2026-08-18 follow-up: "max 1-2
// concurrent calls globally across all instances"):
//  1. Per-isolate FIFO semaphore — cheap, bounds each worker isolate.
//  2. Redis slot leases — N shared slot keys bound the GLOBAL total across
//     isolates. Best-effort: Redis trouble or a saturated wait degrades to
//     layer 1 only (availability over a hard cap), and a crashed holder's
//     slot frees via TTL.
// The per-key single-flight locks (`inflight:{cacheKey}`) and the shared
// backoff gate in lib/upstream-backoff.ts complete the throttling story.
//
// The JWT fetches in lib/ssi-auth.ts intentionally do NOT take a slot: they
// run while executeQueryOnce already holds one, so acquiring here would
// deadlock at limit 1. They are rare and Redis-single-flighted on their own.

import cache from "@/lib/cache-impl";

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

// ─── Global (cross-isolate) slot leases ──────────────────────────────────────

/** Lease TTL must outlive the slowest single upstream call (60s default
 *  GRAPHQL_TIMEOUT_MS) so a crashed holder can't block a slot for long, but
 *  a live slow call never loses its slot mid-flight. */
const SLOT_TTL_SECONDS = 90;

/** How long a caller polls for a global slot before proceeding anyway.
 *  Local semaphore + single-flight locks still bound the damage; a hard
 *  block here would turn one stuck lease into an outage. */
function globalWaitMs(): number {
  const n = parseInt(process.env.UPSTREAM_GLOBAL_WAIT_MS ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

/** Try each slot key once; the lease is the key we managed to claim. */
async function tryClaimSlot(n: number): Promise<string | null> {
  for (let i = 0; i < n; i++) {
    const key = `upstream:slot:${i}`;
    if (await cache.setIfAbsent(key, "1", SLOT_TTL_SECONDS)) return key;
  }
  return null;
}

/** Claim a global slot, polling with jitter up to the wait budget.
 *  Returns the claimed key, or null on fail-open (Redis error / timeout). */
async function acquireGlobalSlot(): Promise<string | null> {
  const n = maxConcurrency();
  const deadline = Date.now() + globalWaitMs();
  try {
    let slot = await tryClaimSlot(n);
    while (slot === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      slot = await tryClaimSlot(n);
    }
    if (slot === null) {
      console.warn("[upstream-limiter] no global slot within budget — proceeding (fail-open)");
    }
    return slot;
  } catch {
    return null; // Redis down — local semaphore still governs.
  }
}

/**
 * Run `fn` while holding an upstream slot (local + best-effort global).
 * Callers should start their own request timeout INSIDE `fn` — time spent
 * queueing here must not count against the upstream fetch timeout.
 */
export async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  let globalSlot: string | null = null;
  try {
    globalSlot = await acquireGlobalSlot();
    return await fn();
  } finally {
    if (globalSlot) {
      try {
        await cache.del(globalSlot);
      } catch { /* lease expires via TTL */ }
    }
    release();
  }
}

/** Test/diagnostics hook. */
export function upstreamLimiterStats(): { inFlight: number; queued: number } {
  return { inFlight, queued: queue.length };
}
