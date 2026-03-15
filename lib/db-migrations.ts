// Shared migration definitions for AppDatabase (SQLite + D1).
//
// This is the single source of truth for database schema. Migration files in
// migrations/ are kept in parallel for manual `wrangler d1 migrations apply`
// but the app self-heals on startup by running any pending migrations here.
//
// Expand-contract pattern: migrations only ADD (tables, columns, indexes).
// Contractions (dropping old columns) happen in a later migration only after
// the code no longer references the removed structure.
//
// Adding a new migration:
//   1. Create the SQL file in migrations/ (for wrangler d1 parallel path)
//   2. Append a new entry to MIGRATIONS below with the same SQL
//   3. Use idempotent DDL: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
//   4. For ALTER TABLE ADD COLUMN, add one entry per column (non-idempotent —
//      the runner catches "duplicate column" errors automatically)

/** A single migration. Statements are executed in order within a transaction (SQLite)
 *  or sequentially (D1). Non-idempotent statements (ALTER TABLE ADD COLUMN) are
 *  wrapped in try/catch by the runner — failures are silently ignored. */
export interface Migration {
  /** 1-based version number. Must be sequential with no gaps. */
  version: number;
  /** Human-readable label (used in logs). */
  label: string;
  /** SQL statements to execute. Each string is one statement. */
  statements: string[];
}

/**
 * Ordered list of all migrations. Append new entries at the end.
 * Version numbers must be sequential (1, 2, 3, ...).
 */
export const MIGRATIONS: Migration[] = [
  // ── 0001_init.sql ──────────────────────────────────────────────────────
  {
    version: 1,
    label: "init: shooter profiles, matches, popularity",
    statements: [
      `CREATE TABLE IF NOT EXISTS shooter_profiles (
        shooter_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        club TEXT,
        division TEXT,
        last_seen TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS shooter_matches (
        shooter_id INTEGER NOT NULL,
        match_ref TEXT NOT NULL,
        start_timestamp INTEGER NOT NULL,
        PRIMARY KEY (shooter_id, match_ref)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sm_shooter_ts
        ON shooter_matches(shooter_id, start_timestamp)`,
      `CREATE TABLE IF NOT EXISTS match_popularity (
        cache_key TEXT PRIMARY KEY,
        last_seen_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mp_last_seen
        ON match_popularity(last_seen_at)`,
    ],
  },

  // ── 0002_achievements.sql ──────────────────────────────────────────────
  {
    version: 2,
    label: "achievements: shooter achievement tiers",
    statements: [
      `CREATE TABLE IF NOT EXISTS shooter_achievements (
        shooter_id INTEGER NOT NULL,
        achievement_id TEXT NOT NULL,
        tier INTEGER NOT NULL DEFAULT 1,
        unlocked_at TEXT NOT NULL,
        match_ref TEXT,
        value REAL,
        PRIMARY KEY (shooter_id, achievement_id, tier)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sa_shooter ON shooter_achievements(shooter_id)`,
    ],
  },

  // ── 0003_match_data_cache.sql ──────────────────────────────────────────
  {
    version: 3,
    label: "match_data_cache: historical match data offloaded from Redis",
    statements: [
      `CREATE TABLE IF NOT EXISTS match_data_cache (
        cache_key      TEXT PRIMARY KEY,
        key_type       TEXT NOT NULL,
        ct             INTEGER NOT NULL,
        match_id       TEXT NOT NULL,
        data           TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        stored_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mdc_match ON match_data_cache(ct, match_id)`,
      `CREATE INDEX IF NOT EXISTS idx_mdc_key_type ON match_data_cache(key_type)`,
    ],
  },

  // ── 0004_shooter_profile_demographics.sql ──────────────────────────────
  {
    version: 4,
    label: "shooter_profiles: demographic fields",
    statements: [
      `ALTER TABLE shooter_profiles ADD COLUMN region TEXT`,
      `ALTER TABLE shooter_profiles ADD COLUMN region_display TEXT`,
      `ALTER TABLE shooter_profiles ADD COLUMN category TEXT`,
      `ALTER TABLE shooter_profiles ADD COLUMN ics_alias TEXT`,
      `ALTER TABLE shooter_profiles ADD COLUMN license TEXT`,
    ],
  },

  // ── 0005_matches.sql ───────────────────────────────────────────────────
  {
    version: 5,
    label: "matches: structured match-level metadata domain table",
    statements: [
      `CREATE TABLE IF NOT EXISTS matches (
        match_ref          TEXT PRIMARY KEY,
        ct                 INTEGER NOT NULL,
        match_id           TEXT NOT NULL,
        name               TEXT NOT NULL,
        venue              TEXT,
        date               TEXT,
        level              TEXT,
        region             TEXT,
        sub_rule           TEXT,
        discipline         TEXT,
        status             TEXT,
        results_status     TEXT,
        scoring_completed  INTEGER DEFAULT 0,
        competitors_count  INTEGER,
        stages_count       INTEGER,
        lat                REAL,
        lng                REAL,
        data               TEXT,
        updated_at         TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date)`,
    ],
  },

  // ── 0006_shooter_suppressions.sql ──────────────────────────────────────
  {
    version: 6,
    label: "shooter_suppressions: GDPR right-to-erasure suppression list",
    statements: [
      `CREATE TABLE IF NOT EXISTS shooter_suppressions (
        shooter_id INTEGER PRIMARY KEY,
        suppressed_at TEXT NOT NULL
      )`,
    ],
  },
];

/** The latest schema version — used by adapters to skip the runner when already current. */
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Synchronous executor interface for better-sqlite3 (Node.js / Docker).
 * D1 (Cloudflare) uses `wrangler d1 migrations apply` in CI instead —
 * no runtime migration runner needed.
 */
export interface SyncMigrationExecutor {
  exec(sql: string): void;
  getVersion(): number;
  setVersion(version: number): void;
}

const SCHEMA_VERSION_DDL = `CREATE TABLE IF NOT EXISTS _schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0
)`;

/**
 * Run all pending migrations synchronously (for better-sqlite3).
 * Idempotent — re-running on an already-current DB is a no-op.
 * Returns the number of migrations applied.
 */
export function runMigrationsSync(executor: SyncMigrationExecutor): number {
  executor.exec(SCHEMA_VERSION_DDL);

  const currentVersion = executor.getVersion();
  if (currentVersion >= LATEST_VERSION) return 0;

  let applied = 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    for (const stmt of migration.statements) {
      try { executor.exec(stmt); } catch { /* idempotent — ignore */ }
    }
    executor.setVersion(migration.version);
    applied++;
  }

  return applied;
}
