# Deployment targets

The app supports two build targets selected by the `DEPLOY_TARGET` env var at build time.

## Docker / Docker Compose (default)

```bash
cp .env.local.example .env.local   # fill in SSI_API_KEY, CACHE_PURGE_SECRET
pnpm docker:build                  # builds image (passes --env-file .env.local)
pnpm docker:up                     # starts redis + app on port 3000
```

`docker:up` passes `--env-file .env.local` so `${SSI_API_KEY}`, `${CACHE_PURGE_SECRET}` are
available at runtime. `REDIS_URL` is set automatically via the compose service name
(`redis://redis:6379`) -- no manual entry needed.

The Dockerfile uses multi-stage builds (deps -> builder -> runner) with a non-root user.
`output: "standalone"` in `next.config.ts` is set automatically when `DEPLOY_TARGET` is unset.

Two named volumes persist state across container restarts:
- `redis_data` -- Redis hot cache (active/recent matches only; can be flushed safely -- D1/SQLite has historical data)
- `shooter_data` -> `/app/data` -- SQLite persistent store (shooter profiles, match indices, popularity, achievements, and historical match data cache)

### Deploying without Docker Compose (bare server, Kubernetes, Fly.io)

Run a Redis instance (managed or self-hosted) and set `REDIS_URL` to its connection string.
Use `rediss://` (TLS) for cloud-managed providers such as Upstash or Redis Cloud.
The app connects with `lazyConnect: true`, so a missing Redis at startup is non-fatal --
requests will fall back to direct GraphQL fetches until Redis is reachable.

## Cloudflare Pages

```bash
pnpm cf:build    # DEPLOY_TARGET=cloudflare @opennextjs/cloudflare build (runs next build internally)
pnpm cf:deploy   # cf:build + wrangler deploy
```

`DEPLOY_TARGET=cloudflare` triggers turbopack/webpack aliases that swap two adapters:
- `lib/cache-impl` -> `lib/cache-edge` (Upstash HTTP instead of ioredis)
- `lib/db-impl` -> `lib/db-d1` (Cloudflare D1 instead of SQLite)

This prevents Node.js-only native modules (`ioredis`, `better-sqlite3`) from being bundled
into the Worker. Route handlers use the default Node.js runtime -- `@opennextjs/cloudflare`
handles the Workers bundling without requiring `export const runtime = "edge"` on each route.

**Cache adapter:** the CF build uses `@upstash/redis` (HTTP-based) instead of ioredis.
`automaticDeserialization: false` is set on the Upstash client so values are returned as raw
strings, consistent with the ioredis adapter -- callers always do their own `JSON.parse`.

**Persistent store:** the CF build uses Cloudflare D1 via the `APP_DB` binding declared in
`wrangler.toml`. D1 holds shooter profiles, match indices, achievements, and the historical
match data cache (offloaded from Upstash Redis). Migrations are applied automatically in CI
before each deploy via `wrangler d1 migrations apply` (see deploy workflows). Migration files
in `migrations/`:
- `0001_init.sql` -- shooter profiles, matches, popularity
- `0002_achievements.sql` -- shooter achievements
- `0003_match_data_cache.sql` -- historical match data cache
- `0004_shooter_profile_demographics.sql` -- demographic fields on shooter profiles
- `0005_matches.sql` -- matches domain table (structured match-level metadata)

**Bindings** (configured in `wrangler.toml`, not secrets):
- `AI` -- Workers AI binding for coaching tips
- `APP_DB` -- D1 database for persistent shooter data

### One-time D1 setup

Use the idempotent setup script (creates databases if missing, patches `wrangler.toml`
with real IDs, applies migrations):

```bash
pnpm tsx scripts/setup-d1.ts           # production + staging
pnpm tsx scripts/setup-d1.ts --staging # staging only
```

Or manually:

```bash
# Production
wrangler d1 create ssi-scoreboard-shooter
# Copy database_id into wrangler.toml [[d1_databases]]
wrangler d1 migrations apply APP_DB

# Staging
wrangler d1 create ssi-scoreboard-shooter-staging
# Copy database_id into wrangler.toml [[env.staging.d1_databases]]
wrangler d1 migrations apply APP_DB --env staging
```

### Secrets

Set via `wrangler secret put` or the Cloudflare dashboard:

```bash
wrangler secret put SSI_API_KEY
wrangler secret put CACHE_PURGE_SECRET
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```
