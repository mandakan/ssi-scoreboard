-- Tracks when a cached match was most recently served to a client.
-- Distinct from `stored_at` (first cache fill); powers the access-overview's
-- "authorized + cached vs uncached" split. Writes are debounced (~60s per key)
-- so this stays near-free even for hot matches.
ALTER TABLE match_data_cache ADD COLUMN last_accessed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_mdc_last_accessed ON match_data_cache(last_accessed_at);
