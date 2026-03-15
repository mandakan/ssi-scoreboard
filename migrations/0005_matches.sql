-- Matches domain table — structured match-level metadata.
-- Populated opportunistically on match page visits and comparisons.
-- Provides durable match identity for the shooter dashboard, especially
-- for upcoming/future matches whose full JSON blob expires from Redis
-- and is not persisted to match_data_cache.

CREATE TABLE IF NOT EXISTS matches (
  match_ref          TEXT PRIMARY KEY,  -- "22:26547" (ct:matchId)
  ct                 INTEGER NOT NULL,
  match_id           TEXT NOT NULL,
  name               TEXT NOT NULL,
  venue              TEXT,
  date               TEXT,              -- ISO 8601
  level              TEXT,              -- code: "1", "2", "3", "4", "5"
  region             TEXT,              -- code: "SWE", "NOR", "FIN"
  sub_rule           TEXT,              -- code
  discipline         TEXT,              -- display: "Handgun", "Rifle"
  status             TEXT,              -- code: "on", "cs" (cancelled)
  results_status     TEXT,              -- code: "org", "all"
  scoring_completed  INTEGER DEFAULT 0,
  competitors_count  INTEGER,
  stages_count       INTEGER,
  lat                REAL,
  lng                REAL,
  data               TEXT,              -- full raw GetMatch JSON blob (fallback)
  updated_at         TEXT NOT NULL       -- ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
