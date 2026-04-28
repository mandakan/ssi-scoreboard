// Cloudflare-target extra sinks — registers an R2 NDJSON sink when the
// `TELEMETRY` binding is present.
//
// ── Why R2 ───────────────────────────────────────────────────────────
// Cloudflare Workers Logs retains for 3 days only. Diagnosing a "data
// stuck" report often requires looking back further. R2 free tier:
//   - 10 GB storage
//   - 1M Class A ops/month (PUT/LIST)
//   - 10M Class B ops/month (GET)
// Plenty of headroom for decision-level telemetry with a 30-day lifecycle.
//
// ── How writes work ──────────────────────────────────────────────────
// R2 has no native append. Concurrent read-modify-write would race, so
// instead each flush writes a *unique-keyed* NDJSON object:
//
//   cache-telemetry/YYYY-MM-DD/HHmmss-NNNN.ndjson
//
// The day prefix groups objects for easy listing; the nonce avoids
// collisions across concurrent isolates. Lifecycle rules on the bucket
// (set once via `wrangler r2 bucket lifecycle set`) auto-delete after
// 30 days so this never grows unbounded.
//
// ── Batching ─────────────────────────────────────────────────────────
// Per-isolate in-memory buffer. The first event in a burst schedules a
// flush via afterResponse() (ctx.waitUntil); subsequent events join the
// buffer. The flush splices the whole buffer atomically, so concurrent
// requests in the same isolate share a single PUT.
//
// ── Sampling ─────────────────────────────────────────────────────────
// Per-domain sample rate, controlled by env vars TELEMETRY_SAMPLE_<DOMAIN>
// (a number between 0 and 1, e.g. 0.1 = keep 10%). Defaults below favour
// "keep all" for low-volume diagnostic domains and tighter sampling for
// high-volume product domains.
//
// Adding a new domain: pick a sensible default in DEFAULT_RATES below.
// Tightening one in production: set TELEMETRY_SAMPLE_<DOMAIN>=0.1 (or 0).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { afterResponse } from "@/lib/background-impl";
import type { TelemetrySink, EnrichedEvent } from "@/lib/telemetry";

interface R2Bucket {
  put(key: string, body: string): Promise<unknown>;
}
interface CFEnvWithTelemetry {
  TELEMETRY?: R2Bucket;
}

// Default sample rates per domain. 1 = keep all; 0 = drop all; 0.1 = 10%.
// Override per domain via TELEMETRY_SAMPLE_<DOMAIN>=<number>.
//
// As of Apr 2026: production sees ~3-6k requests/day. Even at 100% sampling
// the usage domain produces ~600 R2 PUTs/day with per-isolate batching —
// well under 2% of the 1M Class A free-tier monthly cap. With this user
// base it pays to keep everything; tighten the usage rate later only if
// traffic grows ~10x or the volume mix shifts.
const DEFAULT_RATES: Record<string, number> = {
  cache: 1,
  upstream: 1,
  error: 1,
  ai: 1,
  d1: 1,
  background: 1,
  usage: 1,
  mcp: 1,
};

// Catch-all for domains not listed above.
const FALLBACK_RATE = 1;

function getDomainRate(domain: string): number {
  const envKey = `TELEMETRY_SAMPLE_${domain.toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw != null) {
    const n = parseFloat(raw);
    if (!isNaN(n)) return Math.max(0, Math.min(1, n));
  }
  return DEFAULT_RATES[domain] ?? FALLBACK_RATE;
}

const buffer: EnrichedEvent[] = [];
let flushScheduled = false;

const r2Sink: TelemetrySink = (ev) => {
  if (!keepEvent(ev)) return;
  const bucket = getR2Binding();
  if (!bucket) return;

  buffer.push(ev);
  if (flushScheduled) return;
  flushScheduled = true;
  afterResponse(flushBuffer(bucket));
};

function getR2Binding(): R2Bucket | null {
  try {
    const { env } = getCloudflareContext() as unknown as { env: CFEnvWithTelemetry };
    return env?.TELEMETRY ?? null;
  } catch {
    return null;
  }
}

async function flushBuffer(bucket: R2Bucket): Promise<void> {
  const events = buffer.splice(0);
  flushScheduled = false;
  if (events.length === 0) return;
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const key = makeObjectKey(new Date());
  try {
    await bucket.put(key, body);
  } catch (err) {
    // One warning per flush — telemetry must never break the request path.
    console.warn("[telemetry] R2 PUT failed:", err);
  }
}

function makeObjectKey(now: Date): string {
  const iso = now.toISOString(); // 2026-04-28T13:24:05.123Z
  const day = iso.slice(0, 10); // 2026-04-28
  const time = iso.slice(11, 19).replace(/:/g, ""); // 132405
  // 6-hex nonce — collision odds across concurrent isolates within the
  // same second are ~0 for our request volume.
  const nonce = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `cache-telemetry/${day}/${time}-${nonce}.ndjson`;
}

function keepEvent(ev: EnrichedEvent): boolean {
  const rate = getDomainRate(ev.domain);
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export const extraSinks: TelemetrySink[] = [r2Sink];

// Test-only — exported for unit tests of the sampler.
export const _internal = { keepEvent, getDomainRate, makeObjectKey, DEFAULT_RATES };
