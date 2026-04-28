// Server-only — never import from client components.
//
// Typed helper for the "usage" telemetry domain. Records server-side
// product analytics events: which features are being used, with what
// shape, at what scale. Strictly anonymous — every event below has
// been reviewed for PII risk:
//
//   - NO IP addresses, no User-Agent
//   - NO shooter IDs (publicly listed on SSI but a per-user identifier here)
//   - NO competitor IDs (similar reasoning — they correlate to humans)
//   - NO search query strings (people search names — counts only)
//   - Match IDs ARE allowed: matches are public events, IDs are not PII
//
// If a future event needs to log something user-identifying, add it to
// a different domain (e.g. "audit") with stricter sampling — not here.
//
// Sampling: this domain defaults to rate=1 (keep all) given the small
// user base (~3-6k requests/day in Apr 2026 — see telemetry-sinks-cf.ts
// for the math). Tighten with TELEMETRY_SAMPLE_USAGE=0.1 if traffic
// grows ~10x or R2 PUT volume nears the free-tier cap.

import { telemetry } from "@/lib/telemetry";

/** Bucket a count into a small set of cardinality-bounded labels. */
export function bucketCount(n: number): "0" | "1-9" | "10-99" | "100+" {
  if (n <= 0) return "0";
  if (n < 10) return "1-9";
  if (n < 100) return "10-99";
  return "100+";
}

/** Bucket a scoring percentage into match-state labels. */
export function bucketScoring(scoringPct: number): "pre" | "active" | "complete" {
  if (scoringPct <= 0) return "pre";
  if (scoringPct >= 100) return "complete";
  return "active";
}

export type UsageEvent =
  | {
      op: "match-view";
      ct: number;
      level: string | null;
      region: string | null;
      scoringBucket: "pre" | "active" | "complete";
      cacheHit: boolean;
    }
  | {
      op: "comparison";
      ct: number;
      mode: "coaching" | "live";
      nCompetitors: number;
    }
  | {
      // User typed a query (queryLength > 0). For empty/no-text fetches
      // (initial event browse, default shooter list) use op="browse".
      op: "search";
      kind: "events" | "shooter";
      queryLength: number;
      resultBucket: "0" | "1-9" | "10-99" | "100+";
    }
  | {
      // User loaded the events/shooter list without typing — a passive
      // browse rather than an intent-driven search. Helps separate
      // "people are looking at upcoming matches" from "people are
      // hunting for a specific thing".
      op: "browse";
      kind: "events" | "shooter";
      resultBucket: "0" | "1-9" | "10-99" | "100+";
    }
  | {
      op: "shooter-dashboard-view";
      matchCountBucket: "0" | "1-9" | "10-99" | "100+";
      cacheHit: boolean;
    }
  | {
      op: "og-render";
      ct: number;
      variant: "overview" | "single" | "multi" | "fallback";
      nCompetitors: number;
    };

export function usageTelemetry(ev: UsageEvent): void {
  telemetry({ domain: "usage", ...ev });
}
