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

const buffer: EnrichedEvent[] = [];
let flushScheduled = false;

const pipelineSink: TelemetrySink = (ev) => {
  if (!keepEvent(ev)) return;
  const pipeline = getPipelineBinding();
  if (!pipeline) return;

  buffer.push(ev);
  if (flushScheduled) return;
  flushScheduled = true;
  afterResponse(flushBuffer(pipeline));
};

function getPipelineBinding(): PipelineBinding | null {
  try {
    const { env } = getCloudflareContext() as unknown as { env: CFEnvWithTelemetry };
    return env?.TELEMETRY_PIPELINE ?? null;
  } catch {
    return null;
  }
}

async function flushBuffer(pipeline: PipelineBinding): Promise<void> {
  const events = buffer.splice(0);
  flushScheduled = false;
  if (events.length === 0) return;
  const records = events.map((ev) => ({ value: ev }));
  try {
    await pipeline.send(records);
  } catch (err) {
    // One warning per flush — telemetry must never break the request path.
    console.warn("[telemetry] Pipelines send failed:", err);
  }
}

function keepEvent(ev: EnrichedEvent): boolean {
  const rate = getDomainRate(ev.domain);
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export const extraSinks: TelemetrySink[] = [pipelineSink];

// Test-only — exported for unit tests of the sampler.
export const _internal = { keepEvent, getDomainRate, DEFAULT_RATES };
