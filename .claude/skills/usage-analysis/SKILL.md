---
name: usage-analysis
description: Sync R2 telemetry to a local DuckDB and run canned or ad-hoc SQL analysis to guide product decisions. Use when the user asks "what features are people using", "should we keep building X", "how often do match-views convert to comparisons", "what's the p95 latency this week", or wants to slice telemetry beyond what r2-telemetry's --group-by exposes. Triggers on "usage analysis", "product analytics", "duckdb", "sql query against telemetry", "feature uptake", "funnel", or any question that benefits from real SQL over the R2 NDJSON store.
---

# Usage analysis

Sync the R2 telemetry NDJSON store to a local cache, expose it through
DuckDB views, and run analysis. Both Claude (via the script) and the
human operator (via the `duckdb` CLI directly) hit the same `.duckdb`
file, so anything Claude finds is reproducible by hand.

## Quick start

```bash
# 1) Sync new R2 objects (incremental — skips files already cached)
.claude/skills/usage-analysis/scripts/analyze.py sync --since 7d

# 2) Run the canned digest
.claude/skills/usage-analysis/scripts/analyze.py report --days 7

# 3) Ad-hoc SQL
.claude/skills/usage-analysis/scripts/analyze.py sql \
  "SELECT level, count(*) FROM usage_events WHERE op='match-view' GROUP BY level"

# 4) Open the DuckDB file directly for interactive exploration
duckdb $(.claude/skills/usage-analysis/scripts/analyze.py open)
```

Default `--env` is `prod`; pass `--env staging` to point at the staging
bucket.

## What's in the DuckDB

The `setup.sql` (re-run on every invocation) defines five views over the
NDJSON glob `~/.cache/ssi-scoreboard-telemetry/<env>/cache-telemetry/**/*.ndjson`:

- `events` — all events, all domains
- `cache_events` — only `domain='cache'`
- `upstream_events` — only `domain='upstream'`
- `error_events` — only `domain='error'`
- `usage_events` — only `domain='usage'`

The views use `read_ndjson(..., union_by_name=true, ignore_errors=true)`
so the schema grows as new fields appear in the data; queries that
reference a column not yet present anywhere will fail with a Binder
Error (the report wraps each section in a non-strict run, so missing-
column failures show as "(no data)" instead of crashing).

## When to use which subcommand

| You want to... | Use |
|---|---|
| Run a one-off question Claude composed | `analyze.py sql "<sql>"` |
| Get a weekly digest with the most useful aggregations | `analyze.py report` |
| Hand the user the file so they can SQL freely | `analyze.py open` (prints path) |
| See useful query patterns | `analyze.py queries` (prints recipe file) |
| Pull fresh data first | `analyze.py sync` |

For interactive exploration the operator should:

```bash
duckdb $(.claude/skills/usage-analysis/scripts/analyze.py open --env=prod)
D> SELECT op, count(*) FROM usage_events GROUP BY op ORDER BY 2 DESC;
D> .help
```

## Recommended workflow

1. **Sync first** — always run `analyze.py sync` at the start of an
   analysis session. It's incremental (HTTP HEAD + skip-if-exists) so
   re-running is cheap. R2 retains 30 days, so `--since 30d` is a fine
   default for a fresh sync.

2. **Start with `report`** — gives you a one-screen picture of what's
   happening. From there, decide which section is interesting enough
   to drill deeper.

3. **Compose ad-hoc queries** with `analyze.py sql "..."`. Pass
   `--format json` if you want to pipe into another tool, `--format csv`
   for spreadsheet import. Default is markdown — fine for chat output.

4. **Recipe file** (`analyze.py queries`) has working SQL for the
   patterns we expect to use most: match-view → comparison conversion,
   p95 latency by operation by day, cache pinning rate over time, zero-
   result search distribution. Copy + adapt.

## Privacy guarantees still apply

The data in DuckDB is exactly what's in R2 — no IPs, no User-Agents, no
shooter IDs in usage events, no raw search query text. See
`lib/usage-telemetry.ts` for the full contract. If you find yourself
writing a query that wants something not in the schema, *don't* add a
join against another data source — file an issue to discuss whether
that field is appropriate to record.

## Common questions, ready-to-run SQL

```sql
-- Which features are most-used over the past week?
SELECT op, count(*) AS events
FROM usage_events
WHERE ts >= now() - INTERVAL '7 days'
GROUP BY op ORDER BY events DESC;

-- Match-view → comparison conversion rate, daily
WITH m AS (SELECT date_trunc('day', ts) day, count(*) views
           FROM usage_events WHERE op='match-view' AND ts >= now() - INTERVAL '14 days'
           GROUP BY 1),
     c AS (SELECT date_trunc('day', ts) day, count(*) comps
           FROM usage_events WHERE op='comparison' AND ts >= now() - INTERVAL '14 days'
           GROUP BY 1)
SELECT m.day, m.views, c.comps,
       round(100.0 * c.comps / m.views, 1) AS pct
FROM m LEFT JOIN c USING (day) ORDER BY m.day DESC;

-- Cache hit rate trend
SELECT date_trunc('day', ts) AS day,
       sum(CASE WHEN cacheHit THEN 1 ELSE 0 END) AS hits,
       count(*) AS views,
       round(100.0 * sum(CASE WHEN cacheHit THEN 1 ELSE 0 END) / count(*), 1) AS pct
FROM usage_events
WHERE op = 'match-view' AND ts >= now() - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1 DESC;

-- Zero-result search distribution by query length bucket
SELECT
  CASE WHEN queryLength <= 3 THEN '<=3'
       WHEN queryLength <= 6 THEN '4-6'
       WHEN queryLength <= 10 THEN '7-10'
       ELSE '11+' END AS len_bucket,
  kind,
  count(*) AS searches,
  sum(CASE WHEN resultBucket = '0' THEN 1 ELSE 0 END) AS zero_results
FROM usage_events
WHERE op = 'search' AND ts >= now() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Upstream p50 / p95 by operation, this week
SELECT operation,
       count(*) AS calls,
       round(quantile_cont(ms, 0.5), 0) AS p50_ms,
       round(quantile_cont(ms, 0.95), 0) AS p95_ms,
       round(quantile_cont(ms, 0.99), 0) AS p99_ms
FROM upstream_events
WHERE outcome = 'ok' AND ts >= now() - INTERVAL '7 days'
GROUP BY operation ORDER BY p95_ms DESC;
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not find oauth_token` | `wrangler login` |
| `(no data — Binder Error: column ... not found)` | The relevant event op hasn't been written yet (e.g. `usage` is brand-new). Sections fill in once events flow. |
| `(no data)` everywhere | Sync hasn't run — `analyze.py sync` |
| Weird old data still showing | Delete `~/.cache/ssi-scoreboard-telemetry/<env>` and resync |
| Report runs slowly | First sync downloads 30 days × ~600 PUTs/day = ~18k files. After that it's incremental. |

## Where the data lives

```
~/.cache/ssi-scoreboard-telemetry/
  prod/
    cache-telemetry/2026-04-28/052411-51cde0.ndjson
    cache-telemetry/2026-04-28/052433-143099.ndjson
    ...
  staging/
    cache-telemetry/2026-04-28/...
  prod.duckdb     # views only — actual data lives in the NDJSON files
  staging.duckdb
```

Delete a `<env>/` subdirectory and the matching `.duckdb` to reset that
environment.
