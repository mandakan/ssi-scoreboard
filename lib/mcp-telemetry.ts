// Server-only -- never import from client components.
//
// Typed helper for the "mcp" telemetry domain. Records MCP-server-boundary
// events: JSON-RPC requests, tool calls, and auth failures over the
// /api/mcp HTTP transport. Underlying REST endpoints called by tool
// handlers emit their own usage/cache/upstream telemetry; events emitted
// during an MCP-served request additionally carry via:"mcp" via the
// request-scoped context in lib/telemetry-context.ts.
//
// Privacy commitments (same rules as usage):
//   - NO IP addresses, no User-Agent
//   - NO shooter IDs, NO competitor IDs (counts/buckets only)
//   - NO raw search query text -- only queryLength and resultBucket
//   - Match IDs ARE allowed (public events, IDs are not PII)
//
// Sampling: defaults to rate=1. MCP volume is small (a few requests per
// active session); R2 PUT cost is negligible.

import { telemetry } from "@/lib/telemetry";

export type McpTransport = "http";

/** Bucket competitor count for compare_competitors. */
export function bucketCompetitors(n: number): "1" | "2-4" | "5-12" {
  if (n <= 1) return "1";
  if (n <= 4) return "2-4";
  return "5-12";
}

export type McpEvent =
  | {
      op: "request";
      transport: McpTransport;
      /** JSON-RPC method, e.g. "initialize", "tools/list", "prompts/get". */
      method: string;
      ok: boolean;
      latencyMs: number;
      /** JSON-RPC error code (if the response carried an error). */
      errorCode?: number | null;
    }
  | {
      op: "tool-call";
      transport: McpTransport;
      tool: string;
      ok: boolean;
      latencyMs: number;
      errorCode?: number | null;
      /** content-type discriminator for match-bound tools. */
      ct?: number | null;
      /** competitor count bucket for compare_competitors. */
      nCompetitorsBucket?: "1" | "2-4" | "5-12" | null;
      /** raw queryLength for search_events / find_shooter (low cardinality). */
      queryLength?: number | null;
      /** min_level filter for search_events. */
      minLevel?: string | null;
    }
  | {
      op: "auth-fail";
      transport: McpTransport;
      reason: "no-bearer" | "wrong-secret";
    };

export function mcpTelemetry(ev: McpEvent): void {
  telemetry({ domain: "mcp", ...ev });
}
