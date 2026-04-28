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
    }
  // Probe outcome — emitted from refreshCachedMatchQuery to measure
  // how often the cheap "if-modified-since" probe lets us skip a full refetch.
  //   skip            — probe matched the sidecar; no refetch issued
  //   changed         — probe differed from sidecar; full refetch ran
  //   first-seen      — no sidecar state existed; full refetch ran (one-time per match)
  //   error           — probe failed or returned no event; fell back to full refetch
  //   forced-refresh  — probe said skip, but cached entry exceeded max-skip-age
  //                     ceiling; refetched anyway as a staleness safety net
  | {
      op: "match-probe";
      matchKey: string;
      /** Which downstream query the probe gates — lets us weight skip savings
       *  by payload size (scorecards is much heavier than match metadata). */
      keyType: "match" | "scorecards" | "other";
      outcome: "skip" | "changed" | "first-seen" | "error" | "forced-refresh";
      probeMs: number;
      /** Age (seconds) of the cached entry's *original* fetch at decision time.
       *  Lets post-match analysis see how long we were trusting the probe before
       *  the safety net (forced-refresh) fired. Null when the entry was missing
       *  or unparseable. */
      cachedAgeSeconds?: number | null;
      /** Current `IpscMatchNode.updated` returned by the probe. Recording this
       *  lets us answer "did `match.updated` actually move during a real match?"
       *  vs. "did it stay flat while scorecards streamed in?" (the failure mode
       *  this design is exposed to). Match IDs are public — this timestamp is
       *  not sensitive PII. */
      upstreamUpdatedIso?: string | null;
      /** Sidecar's prior `match.updated` — only set on `changed` and
       *  `forced-refresh`. Lets us measure inter-bump intervals and detect
       *  long-flat windows that should have triggered changes. */
      prevUpstreamUpdatedIso?: string | null;
    }
  // Incremental scorecard delta path — emitted from refreshCachedMatchQuery
  // when a `changed` probe outcome attempts a delta fetch instead of a full
  // refetch. Only fires for `keyType=scorecards`.
  //   delta-merge    — delta fetched and merged successfully; full refetch skipped
  //   full-fallback  — merge failed (missing stage, malformed payload, cache miss);
  //                    caller did a full refetch instead
  //   reconcile      — cached entry's original `cachedAt` exceeded the reconcile
  //                    ceiling; full refetch forced to self-heal from drift
  //   error          — delta fetch itself failed (timeout / HTTP / GraphQL error)
  //   disabled       — SCORECARDS_DELTA_ENABLED=off; delta path bypassed
  | {
      op: "scorecards-delta";
      matchKey: string;
      outcome: "delta-merge" | "full-fallback" | "reconcile" | "error" | "disabled";
      /** Number of scorecards in the delta payload (0 on disabled / cache miss). */
      deltaCount: number;
      /** Number of cached scorecards replaced by the merge. */
      updatedCount: number;
      /** Number of scorecards added by the merge that did not exist before. */
      addedCount: number;
      /** Pure merge time (ms) — excludes upstream fetch + cache I/O. */
      mergeMs: number;
      /** Delta payload size (bytes) — used for "bytes saved" computation. */
      deltaBytes: number | null;
      /** Short reason string for full-fallback / error outcomes. */
      reason: string | null;
    };

export function cacheTelemetry(ev: CacheTelemetryEvent): void {
  telemetry({ domain: "cache", ...ev });
}
