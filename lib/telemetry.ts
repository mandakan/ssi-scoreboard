// Server-only — never import from client components.
//
// Generic structured-telemetry transport. Domain-specific helpers (e.g.
// `cacheTelemetry()` in `lib/cache-telemetry.ts`) sit on top of this and
// give callers a typed event shape; this module owns the wire format,
// the on/off switch, and the sink registry.
//
// ── Adding a new domain ───────────────────────────────────────────────
// 1. Create `lib/<domain>-telemetry.ts` exporting a typed wrapper:
//      export function fooTelemetry(ev: FooEvent) { telemetry({ domain: "foo", ...ev }); }
// 2. Define `FooEvent` as a discriminated union on `op`. That gives every
//    call site compile-time field checking inside the domain.
//
// ── Adding a new sink ────────────────────────────────────────────────
// 1. Implement `TelemetrySink` (a function over `EnrichedEvent`).
// 2. Register it via `registerSink()` at module load. For sinks that need
//    a deploy-target-specific runtime (Cloudflare bindings, file system,
//    external HTTP), add it to `lib/telemetry-sinks-cf.ts` (CF) or to the
//    default `lib/telemetry-sinks-impl.ts` (Docker/Node).

import { extraSinks } from "@/lib/telemetry-sinks-impl";
import { getTelemetryContext } from "@/lib/telemetry-context";

export interface TelemetryEvent {
  /** Domain bucket — "cache", "ai", "ratelimit", etc. */
  domain: string;
  /** Operation within the domain — "match-ttl-decision", etc. */
  op: string;
  /** Free-form fields. Keep values primitive so the JSON line stays greppable. */
  [key: string]: string | number | boolean | null | undefined;
}

export interface EnrichedEvent extends TelemetryEvent {
  ts: string;
}

export type TelemetrySink = (ev: EnrichedEvent) => void;

const ENABLED = (process.env.CACHE_TELEMETRY ?? "on").toLowerCase() !== "off";

const sinks: TelemetrySink[] = [consoleSink, ...extraSinks];

export function registerSink(sink: TelemetrySink): void {
  sinks.push(sink);
}

export function telemetry(ev: TelemetryEvent): void {
  if (!ENABLED) return;
  const ctx = getTelemetryContext();
  const enriched: EnrichedEvent = {
    ts: new Date().toISOString(),
    ...ev,
    ...(ctx?.via ? { via: ctx.via } : {}),
  };
  for (const s of sinks) {
    try {
      s(enriched);
    } catch {
      /* never throw into the request path */
    }
  }
}

function consoleSink(ev: EnrichedEvent): void {
  // .info (not .log) is INFO-level and visible by default on Workers Logs,
  // Docker stdout, and `next dev`.
  console.info(JSON.stringify(ev));
}

// Test-only escape hatch.
export function _resetTelemetryForTests(): void {
  sinks.length = 0;
  sinks.push(consoleSink, ...extraSinks);
}
