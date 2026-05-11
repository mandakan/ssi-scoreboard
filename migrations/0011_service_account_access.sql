-- Audit catalog of every club, organization membership, and match the
-- service account currently holds a role on. Refreshed by syncServiceAccountAccess()
-- which queries `me { clubs, organizer_clubs, organization_members }` plus
-- `events(has_role: true)`. Rows not seen in a given sync are soft-deleted by
-- setting revoked_at + revoked_reason so the audit log keeps "had access between
-- X and Y" history.
CREATE TABLE IF NOT EXISTS service_account_access (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT NOT NULL,                  -- club_loose | organizer_club | organization_member | match_role
  ssi_id              TEXT NOT NULL,
  ssi_content_type    INTEGER,                        -- for match rows; null for orgs
  name                TEXT NOT NULL,
  short_name          TEXT,
  org_type            TEXT,
  discipline          TEXT,                           -- for match rows (`get_full_rule_display`)
  role_names          TEXT,                           -- JSON array; for match rows
  member_type         TEXT,
  member_status       TEXT,
  member_start_date   TEXT,
  member_end_date     TEXT,
  is_membership_valid INTEGER,                        -- 0/1 boolean
  match_visibility    TEXT,                           -- raw SSI code for match rows
  match_starts        TEXT,                           -- ISO ts for match rows
  first_seen_at       TEXT NOT NULL,
  last_verified_at    TEXT NOT NULL,
  revoked_at          TEXT,
  revoked_reason      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_saa_natural
  ON service_account_access(kind, ssi_id, COALESCE(ssi_content_type, -1));
CREATE INDEX IF NOT EXISTS idx_saa_kind ON service_account_access(kind);
CREATE INDEX IF NOT EXISTS idx_saa_revoked ON service_account_access(revoked_at);
