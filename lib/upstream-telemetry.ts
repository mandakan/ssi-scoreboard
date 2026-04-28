// Server-only — never import from client components.
//
// Typed helper for the "upstream" telemetry domain. Records every SSI
// GraphQL call (executeQuery in lib/graphql.ts). Useful for:
//   - tracing slow / failing queries to a specific operation + variables
//   - measuring upstream latency p95 over time
//   - correlating user-visible errors with upstream HTTP status codes
//
// Field guide:
//   operation   — GraphQL operation name (GetMatch, GetMatchScorecards, ...)
//   ms          — wall-clock duration of the fetch
//   outcome     — "ok" | "http-error" | "graphql-error" | "timeout" | "empty" | "fetch-error"
//   httpStatus  — set when outcome === "http-error"
//   bytes       — response body size (only on outcome === "ok")
//   varsHash    — short hash of the variables JSON, lets you correlate
//                 repeated calls without logging raw IDs
//   retryAfter  — Retry-After header echoed back by the upstream

import { telemetry } from "@/lib/telemetry";

export type UpstreamOutcome =
  | "ok"
  | "http-error"
  | "graphql-error"
  | "timeout"
  | "empty"
  | "fetch-error";

export interface UpstreamEvent {
  op: "graphql-request";
  operation: string;
  ms: number;
  outcome: UpstreamOutcome;
  httpStatus?: number | null;
  bytes?: number | null;
  varsHash?: string | null;
  retryAfter?: string | null;
  /** Short error class — never the full message (avoids leaking PII). */
  errorClass?: string | null;
}

export function upstreamTelemetry(ev: UpstreamEvent): void {
  telemetry({ domain: "upstream", ...ev });
}

/**
 * Stable short hash for variables — DJB2, mod 2^32, hex-encoded. Not crypto;
 * just enough to group repeated calls in telemetry without leaking raw IDs.
 */
export function hashVariables(vars: Record<string, unknown> | undefined): string {
  if (!vars) return "0";
  const s = JSON.stringify(vars);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}
