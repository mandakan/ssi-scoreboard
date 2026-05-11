-- Host club / organization columns on the matches domain table.
-- Captured from IpscMatchNode.organizer (cache schema v19). Lets the
-- access overview group cached matches by organizing club without
-- re-parsing the cached MatchResponse blob.
ALTER TABLE matches ADD COLUMN organizer_id TEXT;
ALTER TABLE matches ADD COLUMN organizer_name TEXT;
CREATE INDEX IF NOT EXISTS idx_matches_organizer ON matches(organizer_id);
