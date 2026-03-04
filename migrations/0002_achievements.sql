-- Achievement persistence: tracks unlocked achievement tiers per shooter.

CREATE TABLE IF NOT EXISTS shooter_achievements (
  shooter_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  unlocked_at TEXT NOT NULL,
  match_ref TEXT,
  value REAL,
  PRIMARY KEY (shooter_id, achievement_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_sa_shooter ON shooter_achievements(shooter_id);
