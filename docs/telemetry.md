# Telemetry

Structured-event logging for cache decisions and other server-side observability.
Lives in `lib/telemetry.ts` (transport) + per-domain typed wrappers:

- `lib/cache-telemetry.ts` -- match TTL decisions, cache reads, schema evictions
- `lib/upstream-telemetry.ts` -- every SSI GraphQL fetch (latency, outcome, bytes)
- `lib/error-telemetry.ts` -- `reportError(site, err, extra)` for swallowed-catch sites; records error class + truncated message (no stack -- avoids PII)
- `lib/usage-telemetry.ts` -- server-side product analytics (match views, comparisons, searches, OG renders, dashboard views)
- `lib/mcp-telemetry.ts` -- MCP-server-boundary events (JSON-RPC requests, tool calls, auth fails) emitted from `/api/mcp`.

## via:"mcp" enrichment

The MCP HTTP route opens an AsyncLocalStorage telemetry context (`lib/telemetry-context.ts`)
so every event emitted while serving that request carries `via:"mcp"`. Stdio/Smithery MCP
shims call REST endpoints directly with an `x-mcp-client` header; the six routes MCP tools
hit (`/api/events`, `/api/match/[ct]/[id]`, `/api/compare`, `/api/popular-matches`,
`/api/shooter/[shooterId]`, `/api/shooter/search`) call `maybeTagAsMcp(req)` at the top of
the handler to open the same context. Result: any usage/cache/upstream/error/d1 event emitted
under MCP traffic can be filtered with `select(.via == "mcp")` in jq/DuckDB. New REST routes
that the MCP toolset reaches must add `maybeTagAsMcp(req)` to keep this property.

## Privacy commitments -- enforced by code review

- **Never** record IP addresses, User-Agent strings, shooter IDs, or specific competitor IDs.
- **Never** record raw search query text -- only `queryLength` and a bucketed `resultBucket`.
- Match IDs *are* recorded -- matches are public events whose IDs are not personally identifying.
- New `usage` events must use bucketed counts (`bucketCount`, `bucketScoring`) instead of raw numbers when the underlying value could correlate to a person.
- The user-facing privacy policy at `/legal` describes this contract (Section 6). Update it whenever telemetry collection changes.

## Sinks (registered automatically per deploy target)

- `console.info` -- always on. Picked up by Cloudflare Workers Logs and Docker stdout.
- R2 NDJSON -- Cloudflare only, when the `TELEMETRY` binding is present (see `lib/telemetry-sinks-cf.ts`).
  Per-isolate batching, flushed via `ctx.waitUntil()` to one object per request burst at
  `cache-telemetry/YYYY-MM-DD/HHmmss-NNNN.ndjson`. Lifecycle rule on the bucket auto-deletes
  after 30 days. Sampling controlled by `TELEMETRY_SAMPLE`.

## Adding a new domain

1. Create `lib/<domain>-telemetry.ts` with a typed discriminated union over `op`.
2. Export a thin wrapper: `export function fooTelemetry(ev: FooEvent) { telemetry({ domain: "foo", ...ev }); }`.
   No transport changes needed -- the existing sinks handle it automatically.

## Adding a new sink

1. Implement `TelemetrySink` (a function over `EnrichedEvent`).
2. For deploy-target-agnostic sinks: call `registerSink()` at module load.
3. For CF-only sinks: append to `extraSinks` in `lib/telemetry-sinks-cf.ts`.
4. For Docker-only sinks: append to `lib/telemetry-sinks-impl.ts`.

## One-time R2 setup (Cloudflare) -- already applied; documented for reproducibility

```bash
# Production
wrangler r2 bucket create ssi-scoreboard-telemetry
wrangler r2 bucket lifecycle add ssi-scoreboard-telemetry expire-30d "" \
  --expire-days 30 --force

# Staging
wrangler r2 bucket create ssi-scoreboard-telemetry-staging
wrangler r2 bucket lifecycle add ssi-scoreboard-telemetry-staging expire-30d "" \
  --expire-days 30 --force
```

## Reading telemetry

`wrangler` only ships `r2 object get|put|delete` -- there is no `r2 object list`.
Listing has to go through the Cloudflare REST API, using the OAuth token that
`wrangler login` already cached at `~/Library/Preferences/.wrangler/config/default.toml`
(macOS) or `~/.config/.wrangler/config/default.toml` (Linux).

```bash
# Account ID (one-time lookup)
ACCOUNT_ID=$(wrangler whoami 2>&1 | awk -F'│' '/Account ID/{getline; getline; print $3}' | xargs)
TOKEN=$(grep '^oauth_token' ~/Library/Preferences/.wrangler/config/default.toml | \
  sed -E 's/oauth_token = "([^"]+)"/\1/')

# List a day's events (REST API)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/ssi-scoreboard-telemetry/objects" \
  | jq -r '.result[].key' | grep cache-telemetry/2026-04-28/

# Fetch one object (REST -- works as a stream, no wrangler needed)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/ssi-scoreboard-telemetry/objects/cache-telemetry/2026-04-28/132405-a1b2c3.ndjson" \
  | jq 'select(.op == "match-ttl-decision" and .trulyDone == true)'

# Same fetch via wrangler (handy when the path is already known)
wrangler r2 object get ssi-scoreboard-telemetry/cache-telemetry/2026-04-28/132405-a1b2c3.ndjson \
  --pipe | jq -r '.'

# Bulk: download a whole day's prefix and feed into DuckDB / sqlite for analysis
```

The OAuth token rotates every ~hour -- re-run `wrangler login` if curl returns
`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`.
