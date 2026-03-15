import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrationsSync, MIGRATIONS, LATEST_VERSION } from "@/lib/db-migrations";
import type { SyncMigrationExecutor } from "@/lib/db-migrations";

/** Create a migration executor backed by an in-memory SQLite database. */
function createExecutor(db: Database.Database): SyncMigrationExecutor {
  return {
    exec(sql) { db.exec(sql); },
    getVersion() {
      const row = db.prepare(
        `SELECT version FROM _schema_version WHERE id = 1`,
      ).get() as { version: number } | undefined;
      return row?.version ?? 0;
    },
    setVersion(version) {
      db.prepare(
        `INSERT INTO _schema_version (id, version) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
      ).run(version);
    },
  };
}

/** List all user tables in the database (excludes internal/system tables). */
function listTables(db: Database.Database): string[] {
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe("db-migrations", () => {
  it("MIGRATIONS array has sequential version numbers with no gaps", () => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1);
    }
  });

  it("LATEST_VERSION matches the last migration", () => {
    expect(LATEST_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  describe("runMigrations", () => {
    it("applies all migrations to a fresh database", () => {
      const db = new Database(":memory:");
      const executor = createExecutor(db);
      const applied = runMigrationsSync(executor);

      expect(applied).toBe(MIGRATIONS.length);

      // Verify schema version was set
      const version = executor.getVersion();
      expect(version).toBe(LATEST_VERSION);

      // Verify key tables were created
      const tables = listTables(db);
      expect(tables).toContain("shooter_profiles");
      expect(tables).toContain("shooter_matches");
      expect(tables).toContain("match_popularity");
      expect(tables).toContain("shooter_achievements");
      expect(tables).toContain("match_data_cache");
      expect(tables).toContain("matches");
      expect(tables).toContain("_schema_version");
    });

    it("skips already-applied migrations", () => {
      const db = new Database(":memory:");
      const executor = createExecutor(db);

      // First run
      const applied1 = runMigrationsSync(executor);
      expect(applied1).toBe(MIGRATIONS.length);

      // Second run — should be a no-op
      const applied2 = runMigrationsSync(executor);
      expect(applied2).toBe(0);
    });

    it("resumes from a partial migration state", () => {
      const db = new Database(":memory:");
      const executor = createExecutor(db);

      // Simulate: only first 2 migrations were applied previously
      db.exec(
        `CREATE TABLE IF NOT EXISTS _schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL DEFAULT 0
        )`,
      );
      // Manually apply first 2 migrations
      for (const migration of MIGRATIONS.slice(0, 2)) {
        for (const stmt of migration.statements) {
          try { db.exec(stmt); } catch { /* ignore */ }
        }
      }
      db.prepare(
        `INSERT INTO _schema_version (id, version) VALUES (1, 2)`,
      ).run();

      // Run migrations — should apply 3, 4, 5 only
      const applied = runMigrationsSync(executor);
      expect(applied).toBe(MIGRATIONS.length - 2);

      const version = executor.getVersion();
      expect(version).toBe(LATEST_VERSION);

      // Verify tables from later migrations exist
      const tables = listTables(db);
      expect(tables).toContain("match_data_cache");
      expect(tables).toContain("matches");
    });

    it("is idempotent when re-running already-applied DDL", () => {
      const db = new Database(":memory:");
      const executor = createExecutor(db);

      runMigrationsSync(executor);

      // Reset version to 0 to force re-run of all migrations
      db.prepare(`UPDATE _schema_version SET version = 0`).run();

      // Should not throw — all DDL is idempotent
      const applied = runMigrationsSync(executor);
      expect(applied).toBe(MIGRATIONS.length);
    });

    it("creates _schema_version table if missing", () => {
      const db = new Database(":memory:");
      const executor = createExecutor(db);

      // Before running, table doesn't exist
      const tablesBefore = listTables(db);
      expect(tablesBefore).not.toContain("_schema_version");

      runMigrationsSync(executor);

      const tablesAfter = listTables(db);
      expect(tablesAfter).toContain("_schema_version");
    });
  });
});
