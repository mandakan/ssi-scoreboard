// Server-only — never import from client components.
//
// Lightweight structured-logging shim for cache and freshness decisions.
// The aim is to make incidents like the Skepplanda Apr 2026 sync bug
// diagnosable from logs after the fact: we want to be able to grep for
// "ttl=null" decisions on a given match key and see which signal pinned
// it (SSI flag flip, scoring threshold, or historical fallback).
//
// Default behavior: log JSON-shaped lines via console.info (picked up by
// Cloudflare Workers logs, Docker stdout, etc., with zero infra dependency).
// Disable globally with `CACHE_TELEMETRY=off`.

const ENABLED = (process.env.CACHE_TELEMETRY ?? "on").toLowerCase() !== "off";

type CacheTelemetryEvent =
  // Decision points
  | {
      op: "match-ttl-decision";
      matchKey: string;
      scoringPct: number;
      daysSince: number;
      status: string | null;
      resultsPublished: boolean;
      trulyDone: boolean;
      ttl: number | null;
      /** Optional max scorecard timestamp from upstream payload, ISO. */
      lastScorecardAt?: string | null;
    }
  | {
      op: "match-cache-permanent";
      matchKey: string;
      reason: "ttl-null" | "schema-bump-evict";
    }
  // Read-path observations
  | {
      op: "match-cache-read";
      matchKey: string;
      source: "redis" | "d1" | "miss";
      schemaVersion?: number | null;
      ageSeconds?: number | null;
      /** True when the cache hit is older than the freshness window. */
      stale?: boolean;
    }
  // Schema mismatch — cache hit but version too old
  | {
      op: "match-cache-schema-evict";
      matchKey: string;
      foundVersion: number | null;
      expectedVersion: number;
    };

export function cacheTelemetry(ev: CacheTelemetryEvent): void {
  if (!ENABLED) return;
  // One JSON line per event — easy to grep, easy to ship to a log aggregator.
  // Avoid console.log so it doesn't get swallowed by stdout-to-stderr fallback
  // on some hosts; .info is INFO-level and visible by default everywhere.
  try {
    console.info(JSON.stringify({ ts: new Date().toISOString(), ...ev }));
  } catch {
    /* ignore — telemetry must never throw into the request path */
  }
}
