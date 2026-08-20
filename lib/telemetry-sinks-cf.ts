// Cloudflare-target extra sinks — registers a Pipelines sink when the
// `TELEMETRY_PIPELINE` binding is present.
//
// ── Why Pipelines (not raw R2 PUTs) ──────────────────────────────────
// Workers isolates are short-lived and uncoordinated. Writing one R2
// object per isolate flush ("small-files problem") produces thousands
// of tiny .ndjson files per day, which makes the read side painful:
// listing pages slowly, and Cloudflare's REST API rate-limits LIST/GET
// long before we hit any byte budget.
//
// Pipelines coalesces events across isolates and writes one Parquet
// batch to R2 every 300s (or every 5MB), partitioned by UTC day:
//
//   pipelines/cache-telemetry/YYYY-MM-DD/{uuid}.parquet
//
// At our volume this collapses ~2500 files/day → ~288 files/day
// (24h / 5min) and turns NDJSON-line-by-line scans into Parquet with
// predicate pushdown for free. Provisioning lives in wrangler.toml.
//
// ── Wire format ──────────────────────────────────────────────────────
// The stream was created without a schema, so each record is wrapped
// as `{value: <event json>}` — DuckDB then queries fields via
// `value->>'$.<key>'` (see the read scripts).
//
// ── Batching ─────────────────────────────────────────────────────────
// Per-isolate in-memory buffer. The first event in a burst schedules a
// flush via afterResponse() (ctx.waitUntil); subsequent events join the
// buffer. The flush sends the whole buffer in one .send() call so a
// burst becomes a single ingest call to the Pipelines stream.
//
// ── Why the flush re-queues on failure (#524) ────────────────────────
// The binding is an I/O object owned by the request whose context
// produced it. Background work (SWR refreshes via afterResponse, and
// especially promises that missed ctx.waitUntil and run orphaned) can
// emit telemetry while a *different* request is the active context, and
// Workers then rejects the send with "Cannot perform I/O on behalf of a
// different request". Measured against prod 2026-08-20: ~2 failures per
// 42 events during a concurrent burst, each silently dropping the whole
// batch.
//
// Two mitigations, both here: resolve the binding inside the flush (so
// it comes from the context actually executing the send, not the one
// that scheduled it), and put events BACK in the buffer when a send
// fails so the next flush retries them. Losing telemetry biases our
// upstream numbers downward, which is the wrong direction when those
// numbers are what we report to SSI.
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

interface PipelineBinding {
  send(records: { value: EnrichedEvent }[]): Promise<unknown>;
}
interface CFEnvWithTelemetry {
  TELEMETRY_PIPELINE?: PipelineBinding;
}

// Default sample rates per domain. 1 = keep all; 0 = drop all; 0.1 = 10%.
// Override per domain via TELEMETRY_SAMPLE_<DOMAIN>=<number>.
//
// At the volume this product runs (a few thousand requests/day) Pipelines
// keeps full-fidelity ingest comfortably inside the R2 free tier even
// without sampling — defaults stay at "keep all". Tighten only if a
// specific domain proves too noisy.
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

/** Cap on the per-isolate buffer. Only reached when sends keep failing;
 *  trims oldest-first so a persistent outage costs the stalest events
 *  rather than unbounded isolate memory. */
const MAX_BUFFERED_EVENTS = 500;

const buffer: EnrichedEvent[] = [];
let flushScheduled = false;

const pipelineSink: TelemetrySink = (ev) => {
  if (!keepEvent(ev)) return;
  // Presence check only — the binding used for the send is resolved inside
  // the flush, from whichever context actually runs it.
  if (!getPipelineBinding()) return;

  buffer.push(ev);
  trimBuffer();
  if (flushScheduled) return;
  flushScheduled = true;
  afterResponse(flushBuffer());
};

function trimBuffer(): void {
  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
  }
}

function getPipelineBinding(): PipelineBinding | null {
  try {
    const { env } = getCloudflareContext() as unknown as { env: CFEnvWithTelemetry };
    return env?.TELEMETRY_PIPELINE ?? null;
  } catch {
    return null;
  }
}

async function flushBuffer(): Promise<void> {
  const events = buffer.splice(0);
  flushScheduled = false;
  if (events.length === 0) return;

  // Resolve here, not at schedule time: the send must use the binding of
  // the context that is executing it (#524).
  const pipeline = getPipelineBinding();
  if (!pipeline) {
    requeue(events);
    return;
  }

  const records = events.map((ev) => ({ value: ev }));
  try {
    await pipeline.send(records);
  } catch (err) {
    // Re-queue rather than drop; the next flush runs in a fresh context.
    // Telemetry must never break the request path, so this only warns.
    requeue(events);
    console.warn(`[telemetry] Pipelines send failed, re-queued ${events.length} event(s):`, err);
  }
}

/** Put a failed batch back at the front of the buffer for the next flush. */
function requeue(events: EnrichedEvent[]): void {
  buffer.unshift(...events);
  trimBuffer();
}

function keepEvent(ev: EnrichedEvent): boolean {
  const rate = getDomainRate(ev.domain);
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export const extraSinks: TelemetrySink[] = [pipelineSink];

// Test-only — exported for unit tests of the sampler and the flush/re-queue
// path. `buffer` is the live array; tests must reset it between cases.
export const _internal = {
  keepEvent,
  getDomainRate,
  DEFAULT_RATES,
  buffer,
  flushBuffer,
  pipelineSink,
  MAX_BUFFERED_EVENTS,
};
