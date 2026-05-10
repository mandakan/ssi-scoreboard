-- DuckDB schema setup for SSI Scoreboard telemetry analysis.
--
-- Run automatically by analyze.py whenever the .duckdb file is opened.
-- Idempotent — safe to re-run after schema changes.
--
-- Pipelines (since 2026-05) writes Parquet partitioned by UTC day under
-- pipelines/cache-telemetry/YYYY-MM-DD/{uuid}.parquet. The schemaless
-- stream stores every row as a single VARCHAR `value` column whose
-- content is the JSON-serialised input record `{"value": <event>}` —
-- so the actual event lives at JSON path `$.value` inside that string.
-- We promote common fields to columns here and expose `j` (the full
-- event as JSON) for ad-hoc field access.
--
-- Usage from the CLI (after analyze.py sync):
--   duckdb ~/.cache/ssi-scoreboard-telemetry/prod.duckdb
--   D> SELECT count(*) FROM events;
--   D> SELECT op, count(*) FROM usage_events GROUP BY op ORDER BY 2 DESC;
--   D> SELECT j->>'$.matchKey' FROM cache_events LIMIT 5;

INSTALL json;
LOAD json;

-- The CACHE_DIR placeholder is replaced by analyze.py before execution.
CREATE OR REPLACE VIEW raw_events AS
SELECT *
FROM read_parquet(
  'CACHE_DIR/pipelines/cache-telemetry/**/*.parquet',
  filename = true,
  union_by_name = true,
  hive_partitioning = false
);

-- Promote common fields to columns; keep the rest in `j` for queries
-- that need domain-specific shapes (matchKey, ttl, scoringPct, etc.).
CREATE OR REPLACE VIEW events AS
SELECT
  json_extract_string(value, '$.value.ts')        AS ts,
  json_extract_string(value, '$.value.domain')    AS domain,
  json_extract_string(value, '$.value.op')        AS op,
  json_extract_string(value, '$.value.via')       AS via,
  json_extract(value, '$.value')                  AS j,
  filename
FROM raw_events;

CREATE OR REPLACE VIEW cache_events    AS SELECT * FROM events WHERE domain = 'cache';
CREATE OR REPLACE VIEW upstream_events AS SELECT * FROM events WHERE domain = 'upstream';
CREATE OR REPLACE VIEW error_events    AS SELECT * FROM events WHERE domain = 'error';
CREATE OR REPLACE VIEW usage_events    AS SELECT * FROM events WHERE domain = 'usage';
