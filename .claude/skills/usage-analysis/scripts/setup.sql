-- DuckDB schema setup for SSI Scoreboard telemetry analysis.
--
-- Run automatically by analyze.py whenever the .duckdb file is opened.
-- Idempotent — safe to re-run after schema changes.
--
-- Usage from the CLI (after analyze.py sync):
--   duckdb ~/.cache/ssi-scoreboard-telemetry/prod.duckdb
--   D> SELECT count(*) FROM events;
--   D> SELECT op, count(*) FROM usage_events GROUP BY op ORDER BY 2 DESC;

INSTALL json;
LOAD json;

-- The CACHE_DIR placeholder is replaced by analyze.py before execution.
-- We point the view at a glob so newly-synced files appear automatically.

CREATE OR REPLACE VIEW events AS
SELECT *
FROM read_ndjson(
  'CACHE_DIR/cache-telemetry/**/*.ndjson',
  filename = true,
  union_by_name = true,
  ignore_errors = true
);

CREATE OR REPLACE VIEW cache_events    AS SELECT * FROM events WHERE domain = 'cache';
CREATE OR REPLACE VIEW upstream_events AS SELECT * FROM events WHERE domain = 'upstream';
CREATE OR REPLACE VIEW error_events    AS SELECT * FROM events WHERE domain = 'error';
CREATE OR REPLACE VIEW usage_events    AS SELECT * FROM events WHERE domain = 'usage';
