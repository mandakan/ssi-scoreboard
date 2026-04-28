// Server-only -- request-scoped context for telemetry enrichment.
//
// Lets a caller (e.g. /api/mcp) wrap a request in a context so that any
// telemetry event emitted during that request gets enriched with extra
// fields like via:"mcp". Backed by AsyncLocalStorage, which works on
// Node.js and on Cloudflare Workers (nodejs_compat flag enabled in
// wrangler.toml).

import { AsyncLocalStorage } from "node:async_hooks";

export interface TelemetryContext {
  /** Where the request entered the system. "mcp" = via /api/mcp or stdio MCP. */
  via?: "mcp";
}

const storage = new AsyncLocalStorage<TelemetryContext>();

export function runWithTelemetryContext<T>(ctx: TelemetryContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTelemetryContext(): TelemetryContext | undefined {
  return storage.getStore();
}

/**
 * If the request carries the `x-mcp-client` header (set by stdio/Smithery
 * MCP shims in lib/mcp-tools.ts), tag the current request's telemetry
 * context with via:"mcp" so downstream events are enriched.
 *
 * Uses AsyncLocalStorage.enterWith — the tag scopes to the current async
 * chain, which in a Next.js route handler is the request's own task.
 *
 * Call this once at the top of any REST handler that MCP tools hit. The
 * /api/mcp HTTP route opens its own context via runWithTelemetryContext,
 * so it does not need this helper.
 */
export function maybeTagAsMcp(req: Request): void {
  if (req.headers.get("x-mcp-client")) {
    storage.enterWith({ via: "mcp" });
  }
}
