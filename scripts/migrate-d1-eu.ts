#!/usr/bin/env node
/**
 * Migrate D1 databases to EU jurisdiction.
 *
 * D1 databases cannot be relocated after creation. This script:
 * 1. Creates a new database with --jurisdiction eu
 * 2. Applies migrations to set up the schema
 * 3. Exports data per table from the old database (skipping match_data_cache
 *    whose large JSON blobs exceed D1's statement size limit — it self-heals
 *    from Redis/API on first access)
 * 4. Imports each table's data into the new database
 * 5. Patches wrangler.toml with the new database ID and name
 *
 * The old database is NOT deleted — verify the new one works before
 * deleting it manually: npx wrangler d1 delete <old-db-name>
 *
 * Usage:
 *   pnpm tsx scripts/migrate-d1-eu.ts              # migrate both prod and staging
 *   pnpm tsx scripts/migrate-d1-eu.ts --prod       # production only
 *   pnpm tsx scripts/migrate-d1-eu.ts --staging    # staging only
 *   pnpm tsx scripts/migrate-d1-eu.ts --dry-run    # show what would happen
 *
 * Prerequisites:
 *   - wrangler installed (already in devDependencies)
 *   - Logged in: wrangler login  OR  CLOUDFLARE_API_TOKEN set
 *   - Existing databases must be accessible
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const WRANGLER_TOML = join(process.cwd(), "wrangler.toml");

// Old database names (will be suffixed with "-eu" for the new ones)
const PROD_DB_NAME = "ssi-scoreboard-app-db";
const STAGING_DB_NAME = "ssi-scoreboard-app-db-staging";

// New EU database names
const PROD_EU_DB_NAME = "ssi-scoreboard-app-db-eu";
const STAGING_EU_DB_NAME = "ssi-scoreboard-app-db-staging-eu";

// Tables with large JSON blobs that exceed D1's per-statement limit.
// These are skipped during migration and self-heal from Redis/API.
const SKIP_TABLES = ["match_data_cache"];

// Tables to migrate (in dependency order). d1_migrations is handled
// automatically by wrangler d1 migrations apply.
const DATA_TABLES = [
  "shooter_profiles",
  "shooter_matches",
  "shooter_achievements",
  "match_popularity",
  "matches",
  "shooter_suppressions",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function runMerged(cmd: string): string {
  return execSync(`${cmd} 2>&1`, { encoding: "utf-8", shell: "/bin/sh" });
}

function runVisible(cmd: string): void {
  execSync(cmd, { encoding: "utf-8", stdio: "inherit" });
}

interface D1Database {
  name: string;
  uuid: string;
}

function listDatabases(): D1Database[] {
  const output = run("npx wrangler d1 list --json");
  return JSON.parse(output) as D1Database[];
}

function findDatabase(name: string): D1Database | undefined {
  return listDatabases().find((db) => db.name === name);
}

function createEuDatabase(name: string): string {
  console.log(`  Creating EU-jurisdiction database: ${name}`);
  const output = runMerged(`npx wrangler d1 create ${name} --jurisdiction eu`);
  const uuidMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(output);
  if (!uuidMatch) {
    throw new Error(`Could not parse database_id from wrangler output:\n${output}`);
  }
  console.log(`  Created: ${name} (${uuidMatch[1]})`);
  return uuidMatch[1];
}

function exportTable(dbName: string, table: string, outputPath: string): void {
  console.log(`    Exporting table: ${table}`);
  runVisible(`npx wrangler d1 export ${dbName} --remote --output ${outputPath} --table ${table} --no-schema`);
}

function importSqlFile(dbName: string, sqlFile: string): void {
  runVisible(`npx wrangler d1 execute ${dbName} --remote --file ${sqlFile} --yes`);
}

function cleanupFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* ignore */ }
}

function patchWranglerToml(oldId: string, newId: string, label: string): void {
  const content = readFileSync(WRANGLER_TOML, "utf-8");
  if (!content.includes(oldId)) {
    console.log(`  Warning: old ID ${oldId} not found in wrangler.toml`);
    return;
  }
  const updated = content.replace(oldId, newId);
  writeFileSync(WRANGLER_TOML, updated, "utf-8");
  console.log(`  Patched wrangler.toml [${label}]: ${oldId} → ${newId}`);
}

function patchDbName(oldName: string, newName: string): void {
  const content = readFileSync(WRANGLER_TOML, "utf-8");
  if (!content.includes(`database_name = "${oldName}"`)) {
    console.log(`  Warning: database_name "${oldName}" not found in wrangler.toml`);
    return;
  }
  const updated = content.replace(
    `database_name = "${oldName}"`,
    `database_name = "${newName}"`,
  );
  writeFileSync(WRANGLER_TOML, updated, "utf-8");
  console.log(`  Patched wrangler.toml database_name: ${oldName} → ${newName}`);
}

// ─── Migration ───────────────────────────────────────────────────────────────

function migrateDatabase(
  oldName: string,
  newName: string,
  label: string,
  envFlag: string,
  dryRun: boolean,
): void {
  console.log(`\n── ${label} ──────────────────────────────────────────────`);

  // Check if old database exists
  const oldDb = findDatabase(oldName);
  if (!oldDb) {
    console.log(`  Old database "${oldName}" not found — skipping.`);
    return;
  }
  console.log(`  Old database: ${oldName} (${oldDb.uuid})`);

  // Check if new EU database already exists
  const existingEu = findDatabase(newName);
  if (existingEu) {
    console.log(`  EU database "${newName}" already exists (${existingEu.uuid}).`);
    console.log(`  Patching wrangler.toml to use it...`);
    if (!dryRun) {
      patchWranglerToml(oldDb.uuid, existingEu.uuid, label);
      patchDbName(oldName, newName);
    }
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would:`);
    console.log(`    1. Create new DB "${newName}" with --jurisdiction eu`);
    console.log(`    2. Apply migrations to create schema`);
    console.log(`    3. Export and import data table by table:`);
    for (const t of DATA_TABLES) console.log(`       - ${t}`);
    console.log(`    4. Skip tables (self-heal from cache): ${SKIP_TABLES.join(", ")}`);
    console.log(`    5. Patch wrangler.toml: ${oldDb.uuid} → <new-id>`);
    console.log(`    6. Patch wrangler.toml database_name: ${oldName} → ${newName}`);
    return;
  }

  // Step 1: Create EU database
  const newId = createEuDatabase(newName);

  // Step 2: Temporarily patch wrangler.toml so migrations target the new DB
  patchWranglerToml(oldDb.uuid, newId, label);
  patchDbName(oldName, newName);

  // Step 3: Apply migrations to create schema
  console.log(`  Applying migrations...`);
  try {
    runVisible(`npx wrangler d1 migrations apply APP_DB${envFlag} --remote`);
  } catch (err) {
    console.warn(`  Warning: migration command exited non-zero (tables may already exist)`);
    if (err instanceof Error) console.warn(`    ${err.message.split("\n")[0]}`);
  }

  // Step 4: Export and import data table by table
  console.log(`  Migrating data...`);
  const tmpDir = "/tmp";
  let tablesImported = 0;

  for (const table of DATA_TABLES) {
    const exportPath = join(tmpDir, `${oldName}-${table}.sql`);
    try {
      // Export from OLD database — we need to temporarily restore the old ID
      // Actually, use the old database name directly since it still exists
      exportTable(oldName, table, exportPath);

      // Check if the export has any INSERT statements
      const content = readFileSync(exportPath, "utf-8");
      const insertCount = (content.match(/INSERT INTO/g) || []).length;
      if (insertCount === 0) {
        console.log(`      (empty — skipped)`);
        cleanupFile(exportPath);
        continue;
      }

      console.log(`      ${insertCount} rows → importing...`);
      importSqlFile(newName, exportPath);
      tablesImported++;
    } catch (err) {
      console.warn(`    Warning: failed to migrate table ${table}`);
      if (err instanceof Error) console.warn(`      ${err.message.split("\n")[0]}`);
    } finally {
      cleanupFile(exportPath);
    }
  }

  console.log(`\n  Migration complete for ${label}.`);
  console.log(`  ${tablesImported}/${DATA_TABLES.length} tables imported.`);
  if (SKIP_TABLES.length > 0) {
    console.log(`  Skipped (will self-heal): ${SKIP_TABLES.join(", ")}`);
  }
  console.log(`  Old database "${oldName}" (${oldDb.uuid}) is still intact.`);
  console.log(`  After verifying, delete it with: npx wrangler d1 delete ${oldName}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prodOnly = args.includes("--prod");
  const stagingOnly = args.includes("--staging");
  const dryRun = args.includes("--dry-run");

  const doProd = !stagingOnly;
  const doStaging = !prodOnly;

  console.log("D1 EU jurisdiction migration");
  if (dryRun) console.log("(dry run — no changes will be made)\n");

  if (doProd) {
    migrateDatabase(PROD_DB_NAME, PROD_EU_DB_NAME, "Production", "", dryRun);
  }

  if (doStaging) {
    migrateDatabase(STAGING_DB_NAME, STAGING_EU_DB_NAME, "Staging", " --env staging", dryRun);
  }

  console.log("\n─────────────────────────────────────────────────────────");
  if (dryRun) {
    console.log("Dry run complete. Run without --dry-run to execute.");
  } else {
    console.log("Done. Redeploy to use the new EU databases.");
    console.log("After verifying, delete old databases:");
    if (doProd) console.log(`  npx wrangler d1 delete ${PROD_DB_NAME}`);
    if (doStaging) console.log(`  npx wrangler d1 delete ${STAGING_DB_NAME}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
