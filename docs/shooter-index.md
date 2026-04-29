# Shooter Index & Match Backfill

The shooter dashboard (`/shooter/{id}`) shows cross-competition stats. It relies on
persistent **AppDatabase** (SQLite on Docker, D1 on Cloudflare) to track which matches
each shooter has appeared in. This data survives Redis flushes. The database is populated
through several paths:

| Path | Indexes who? | When? | GraphQL calls? |
|------|-------------|-------|----------------|
| Match page view (`fetchMatchData`) | ALL competitors | On every match page visit | Only on cache miss |
| Compare API (`/api/compare`) | ALL competitors | On every comparison | Only on cache miss |
| `warm-cache.ts` | **Known shooters only** | During scheduled/manual warming | Zero (data already fetched) |
| Backfill endpoint (`POST /api/shooter/{id}/backfill`) | **One specific shooter** | On-demand from dashboard | Zero (reads cached data) |
| Add-match endpoint (`POST /api/shooter/{id}/add-match`) | ALL competitors | When user submits a URL | Only if match not cached |

**"Known shooter"** = a shooterId that has a row in the `shooter_profiles` table
(i.e. the app has seen them before through normal usage, warm-cache, or backfill).

**Important scope limitation:** the backfill scan can discover matches in both the Redis cache
**and** the D1/SQLite `match_data_cache` table (keys are unioned). Matches never viewed by anyone
on the app are invisible to both. The add-match endpoint is the only path that can reach an
arbitrary SSI match.

## AppDatabase tables (same schema on SQLite and D1)

- `shooter_profiles` -- `{ shooter_id PK, name, club, division, last_seen }` -- permanent; searchable via `db.searchShooterProfiles(query, { limit })` (case-insensitive LIKE, empty query returns recently active)
- `shooter_matches` -- `{ shooter_id, match_ref, start_timestamp }` -- composite PK, capped at 200 per shooter
- `match_popularity` -- `{ cache_key PK, last_seen_at, hit_count }` -- tracks popular `gql:GetMatch:*` keys
- `shooter_achievements` -- `{ shooter_id, achievement_id, tier }` -- composite PK, persists unlocked tiers with `unlocked_at`, `match_ref`, `value`
- `match_data_cache` -- `{ cache_key PK, key_type, ct, match_id, data (JSON blob), schema_version, stored_at }` -- durable store for historical match data offloaded from Redis (GetMatch, GetMatchScorecards, matchglobal)
- `matches` -- `{ match_ref PK, ct, match_id, name, venue, date, level, region, sub_rule, discipline, status, results_status, scoring_completed, competitors_count, stages_count, lat, lng, data, updated_at }` -- structured match-level metadata, populated opportunistically on every match page visit via `indexMatchShooters()`. Provides durable match identity for the shooter dashboard (especially upcoming matches whose full JSON blob expires from Redis). This is an **opportunistic index**, not a complete catalogue -- landing page search still uses the GraphQL API.

## Tiered match data read path

```
Redis (hot cache) -> D1/SQLite match_data_cache -> GraphQL API
```

When a completed match is persisted to D1 (`persistToMatchStore()`), its Redis key gets a
24h drain TTL. Historical match data thus self-drains from Redis, freeing storage. Active
and recent matches remain in Redis at their normal TTLs.

**Still in Redis only (ephemeral):**
- `computed:shooter:{id}:dashboard` -- pre-computed dashboard JSON, 5min TTL
- `backfill:lock:{id}` -- 60s cooldown lock

`lib/backfill.ts` is the core scan logic -- dependency-injected (no direct cache/db
imports) so it can be unit-tested with mocked deps. `lib/shooter-index.ts` handles the
actual AppDatabase writes via the `AppDatabase` interface.

## Schema migrations

Schema is defined in two places that must be kept in sync:
- `lib/db-migrations.ts` -- `MIGRATIONS` array, used by the SQLite adapter's runtime
  migration runner (`runMigrationsSync`). Auto-applies on first DB access (Docker).
- `migrations/*.sql` -- SQL files applied by `wrangler d1 migrations apply` (Cloudflare D1).
  Applied automatically in CI before each deploy (see `deploy-cloudflare.yml` and
  `deploy-staging.yml`).

- Migrations are idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ADD COLUMN` failures are silently caught (column already exists)
- Expand-contract pattern: migrations only ADD -- never drop or rename in the same release

**Adding a new migration:**
1. Append a new entry to `MIGRATIONS` in `lib/db-migrations.ts` (increment version)
2. Create a matching SQL file in `migrations/` (for D1)
3. Use idempotent DDL; one statement per array entry for `ALTER TABLE ADD COLUMN`

## One-time data migrations

- `scripts/migrate-shooter-data.ts` -- one-time script that reads existing shooter data from
  Redis sorted sets and writes it to SQLite. Run after deploying the AppDatabase change to
  preserve historical data. Use `--cleanup` to delete permanent Redis keys (shooter profiles,
  match sorted sets, popularity sets) after migration -- this frees Upstash storage quota since
  those keys are now in SQLite.
- `scripts/migrate-match-cache.ts` -- one-time script that moves permanent match data from Redis
  to D1/SQLite. Run after deploying migration 0003 (`match_data_cache` table). Scans all
  permanent `gql:GetMatch:*`, `gql:GetMatchScorecards:*`, and `computed:matchglobal:*` keys.
  Use `--drain` to set a 24h TTL on migrated Redis keys (freeing Redis storage over 24h).
  Use `--dry-run` to preview, `--limit N` to cap the number of keys migrated.

**Match cache migration steps (Cloudflare):**
1. Deploy the code (creates `match_data_cache` table via migration 0003)
2. Run: `wrangler d1 migrations apply APP_DB` (if not auto-applied)
3. Run: `pnpm tsx scripts/migrate-match-cache.ts --drain` to move permanent Redis keys to D1
4. Verify: Upstash storage drops over 24h as drained keys expire

**Match cache migration steps (Docker):**
1. Deploy the code (SQLite table auto-created via `CREATE TABLE IF NOT EXISTS`)
2. Run: `pnpm tsx scripts/migrate-match-cache.ts --drain` to move permanent Redis keys to SQLite
3. Verify: Redis `DBSIZE` drops over 24h as drained keys expire
