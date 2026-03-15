-- GDPR right-to-erasure suppression list.
-- Suppressed shooters are excluded from indexing, search, and dashboard.
-- Only the numeric shooter_id is stored (no personal data).
CREATE TABLE IF NOT EXISTS shooter_suppressions (
  shooter_id INTEGER PRIMARY KEY,
  suppressed_at TEXT NOT NULL
);
