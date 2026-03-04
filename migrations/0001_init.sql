-- ShooterStore schema for Cloudflare D1
-- Apply with: wrangler d1 migrations apply SHOOTER_DB

CREATE TABLE IF NOT EXISTS shooter_profiles (
  shooter_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  club TEXT,
  division TEXT,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shooter_matches (
  shooter_id INTEGER NOT NULL,
  match_ref TEXT NOT NULL,
  start_timestamp INTEGER NOT NULL,
  PRIMARY KEY (shooter_id, match_ref)
);
CREATE INDEX IF NOT EXISTS idx_sm_shooter_ts
  ON shooter_matches(shooter_id, start_timestamp);

CREATE TABLE IF NOT EXISTS match_popularity (
  cache_key TEXT PRIMARY KEY,
  last_seen_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mp_last_seen
  ON match_popularity(last_seen_at);
