// Server-only — never import from client components.
//
// Typed helper for the "cache" telemetry domain. Owns the event shape;
// the actual transport (console / R2 / future sinks) lives in
// `lib/telemetry.ts`.
//
// To add a new cache event, extend the union below. To add a new
// *domain*, create a sibling file (e.g. `lib/ai-telemetry.ts`) with its
// own discriminated union and a wrapper that calls `telemetry()`.

import { telemetry } from "@/lib/telemetry";

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
  telemetry({ domain: "cache", ...ev });
}
