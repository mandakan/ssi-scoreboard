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
// Controlled by TELEMETRY_SAMPLE env var:
//   - "all"    (default): keep every event
//   - "signal":            keep only the events most useful for incident
//                          response (see shouldSampleSignal below)
// The sampler is a pure function — easy to extend with new rules.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { afterResponse } from "@/lib/background-impl";
import type { TelemetrySink, EnrichedEvent } from "@/lib/telemetry";

interface R2Bucket {
  put(key: string, body: string): Promise<unknown>;
}
interface CFEnvWithTelemetry {
  TELEMETRY?: R2Bucket;
}

const SAMPLE_MODE = (process.env.TELEMETRY_SAMPLE ?? "all").toLowerCase();

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
  if (SAMPLE_MODE === "all") return true;
  if (SAMPLE_MODE === "signal") return shouldSampleSignal(ev);
  return true;
}

// High-signal events — the ones that pay off when reading historical logs
// to diagnose a sync incident. Other events get dropped under SAMPLE=signal.
function shouldSampleSignal(ev: EnrichedEvent): boolean {
  if (ev.domain !== "cache") return true; // future domains pass through
  if (ev.op === "match-ttl-decision" && ev.trulyDone === true) return true;
  if (ev.op === "match-cache-schema-evict") return true;
  if (ev.op === "match-cache-read" && ev.stale === true) return true;
  return false;
}

export const extraSinks: TelemetrySink[] = [r2Sink];

// Test-only — exported for unit tests of the sampler.
export const _internal = { keepEvent, shouldSampleSignal, makeObjectKey };
