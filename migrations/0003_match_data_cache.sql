-- Migration: match_data_cache
-- Stores historical match data (GetMatch, GetMatchScorecards, matchglobal)
-- as raw JSON blobs, offloading them from Redis to durable storage.

CREATE TABLE IF NOT EXISTS match_data_cache (
  cache_key      TEXT PRIMARY KEY,
  key_type       TEXT NOT NULL,
  ct             INTEGER NOT NULL,
  match_id       TEXT NOT NULL,
  data           TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  stored_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mdc_match ON match_data_cache(ct, match_id);
CREATE INDEX IF NOT EXISTS idx_mdc_key_type ON match_data_cache(key_type);
