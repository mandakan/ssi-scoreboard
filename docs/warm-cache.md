# Cache Warming

The cache warmer pre-populates Redis with match data from the SSI GraphQL API so
that the first real user request for a historical match is served from cache rather
than triggering a live GraphQL fetch.

The primary use case is **after a `CACHE_SCHEMA_VERSION` bump** — old cache entries
are automatically treated as misses, so without warming the cache every match page
will incur a cold GraphQL fetch until a user happens to visit it.

---

## How it works

The script calls the SSI GraphQL API directly and writes results straight into Redis
using the same cache key format and entry structure as the app:

```
gql:GetMatch:{"ct":22,"id":"26547"}          → permanent (no TTL)
gql:GetMatchScorecards:{"ct":22,"id":"26547"} → permanent (no TTL)
```

Crucially, it does **not** go through the Next.js route handlers and never calls
`recordMatchAccess()`, so the **popular-matches sorted sets are not affected** — the
matches you warm will not appear in the "recently viewed" section.

Only matches that started at least 4 days ago are eligible for warming, which
guarantees scoring is complete and the cache entry will be written with a permanent
TTL (no expiry).

---

## Prerequisites

- Redis must be running and reachable (see `REDIS_URL` below)
- `SSI_API_KEY` must be set (`.env.local` is loaded automatically when running from
  the repo root)

---

## Usage

Run from the repo root:

```bash
pnpm warm-cache [options]
```

Or directly with tsx:

```bash
npx tsx scripts/warm-cache.ts [options]
```

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--level <value>` | `l3plus` | Minimum event level: `all`, `l2plus`, `l3plus`, `l4plus` |
| `--country <ISO-3>` | *(all)* | Filter by country code, e.g. `SWE`, `NOR`, `FIN` |
| `--after <YYYY-MM-DD>` | 1 year ago | Only fetch matches starting after this date |
| `--before <YYYY-MM-DD>` | 4 days ago | Only fetch matches starting before this date |
| `--delay <ms>` | `5000` | Base delay between GraphQL requests |
| `--jitter` | off | Add ±50% random jitter to each delay (e.g. 5000ms → 2500–7500ms) |
| `--limit <n>` | *(all)* | Stop after warming this many matches |
| `--skip-scorecards` | off | Only warm `GetMatch`, skip `GetMatchScorecards` |
| `--dry-run` | off | Print the list of matches that would be warmed, without writing anything |
| `--force` | off | Re-warm even if the entry is already cached at the current schema version |

---

## Common recipes

**Preview what would be warmed (always start here):**

```bash
pnpm warm-cache --dry-run --level l3plus --country SWE
```

**Warm all L3+ Swedish matches from the past year:**

```bash
pnpm warm-cache --level l3plus --country SWE --jitter
```

**Full re-warm after a schema version bump — all L2+ matches, courteous pacing:**

```bash
pnpm warm-cache --level l2plus --force --delay 5000 --jitter
```

**Only match overview data (no scorecard payload), faster and lighter:**

```bash
pnpm warm-cache --level l3plus --skip-scorecards --jitter
```

**Narrow date window, e.g. just last season:**

```bash
pnpm warm-cache --level l2plus --after 2024-09-01 --before 2025-03-01 --jitter
```

---

## Rate limiting

The `--delay` and `--jitter` flags control how aggressively the script hits the
upstream GraphQL API.

- Each match requires two requests: `GetMatch` and `GetMatchScorecards` (unless
  `--skip-scorecards` is used). A delay is inserted after each request.
- `--jitter` applies uniform randomness in the range `[0.5×, 1.5×]` the base delay,
  so `--delay 5000 --jitter` produces waits between 2.5 s and 7.5 s.
- The actual wait used is printed on each request so you can see the variation.

The defaults (`5000ms` base, no jitter) are deliberately conservative. Enable
`--jitter` whenever warming a large number of matches to avoid clock-regular request
patterns.

---

## Environment variables

The script reads `.env.local` automatically when run from the repo root.

| Variable | Description |
|---|---|
| `SSI_API_KEY` | ShootNScoreIt API key — required |
| `UPSTASH_REDIS_REST_URL` | Upstash REST endpoint — takes priority over `REDIS_URL` when set |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token — required when using Upstash |
| `REDIS_URL` | ioredis connection string (default: `redis://localhost:6379`) — used when Upstash vars are absent |
| `CACHE_KEY_PREFIX` | Key prefix applied to every Redis write (e.g. `staging:`) — must match the app's setting |

When both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present the
script uses the Upstash REST adapter (same as the Cloudflare Pages build). Otherwise
it falls back to ioredis for Docker / local Redis. The active backend and any prefix
are printed in the header when a live run starts.

---

## Troubleshooting

**`SSI_API_KEY is not set`**
Ensure `.env.local` exists in the repo root and contains `SSI_API_KEY=your_key_here`,
or export the variable in your shell before running the script.

**`Redis connection failed`**
Check that Redis is running (`docker compose up redis` or your managed Redis URL is
correct in `REDIS_URL`). The app's Docker Compose setup starts Redis automatically;
the script requires it to be reachable before warming begins.

**`0 matches after filters`**
Try `--dry-run --level l2plus` without a country filter to see the full unfiltered
list. Matches from the last 4 days are excluded regardless of other filters.

**Match appears still active — skipped**
The script fetches `scoring_completed` from the API and refuses to write a permanent
cache entry for a match that is still scoring (< 95% complete and < 3 days old).
This is a safety guard; the match will become eligible once scoring finishes.
