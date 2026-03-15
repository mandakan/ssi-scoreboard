#!/usr/bin/env node
/**
 * Idempotent D1 setup script.
 *
 * Creates Cloudflare D1 databases for production and/or staging (if they don't
 * already exist), patches wrangler.toml with real database IDs, and applies
 * pending migrations. Safe to re-run at any time.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/setup-d1.ts            # set up both prod and staging
 *   pnpm tsx scripts/setup-d1.ts --prod     # production only
 *   pnpm tsx scripts/setup-d1.ts --staging  # staging only
 *
 * Prerequisites:
 *   - wrangler installed (already in devDependencies)
 *   - Logged in: wrangler login  OR  CLOUDFLARE_API_TOKEN set
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const WRANGLER_TOML = join(process.cwd(), "wrangler.toml");

const PROD_DB_NAME = "ssi-scoreboard-app-db";
const STAGING_DB_NAME = "ssi-scoreboard-app-db-staging";

const PROD_PLACEHOLDER = "PLACEHOLDER_PRODUCTION_D1_ID";
const STAGING_PLACEHOLDER = "PLACEHOLDER_STAGING_D1_ID";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function runMerged(cmd: string): string {
  // Merge stderr into stdout — wrangler writes its output to stderr on some
  // commands, so we need both streams to reliably parse the result.
  return execSync(`${cmd} 2>&1`, { encoding: "utf-8", shell: "/bin/sh" });
}

interface D1Database {
  name: string;
  uuid: string;
}

function listDatabases(): D1Database[] {
  const output = run("npx wrangler d1 list --json");
  return JSON.parse(output) as D1Database[];
}

function findOrCreate(dbName: string): string {
  const databases = listDatabases();
  const existing = databases.find((db) => db.name === dbName);

  if (existing) {
    console.log(`  Found existing database: ${dbName} (${existing.uuid})`);
    return existing.uuid;
  }

  console.log(`  Creating database: ${dbName} (jurisdiction: eu)`);
  // d1 create does not support --json; parse UUID from plain-text output.
  // Use runMerged so we capture wrangler's stderr output (where it prints the ID).
  // --jurisdiction eu: restrict storage and execution to EU data centres.
  const output = runMerged(`npx wrangler d1 create ${dbName} --jurisdiction eu`);
  const uuidMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(output);
  if (!uuidMatch) {
    throw new Error(`Could not parse database_id from wrangler output:\n${output}`);
  }
  const uuid = uuidMatch[1];
  console.log(`  Created: ${dbName} (${uuid})`);
  return uuid;
}

function patchWranglerToml(placeholder: string, realId: string): void {
  const content = readFileSync(WRANGLER_TOML, "utf-8");
  if (!content.includes(placeholder)) {
    if (content.includes(realId)) {
      console.log(`  wrangler.toml already has the correct ID`);
    } else {
      console.log(`  Warning: placeholder '${placeholder}' not found in wrangler.toml`);
    }
    return;
  }
  const updated = content.replace(placeholder, realId);
  writeFileSync(WRANGLER_TOML, updated, "utf-8");
  console.log(`  Patched wrangler.toml: ${placeholder} → ${realId}`);
}

function applyMigrations(binding: string, env?: string): void {
  const envFlag = env ? ` --env ${env}` : "";
  console.log(`  Applying migrations for ${binding}${env ? ` (${env})` : ""}...`);
  try {
    const output = runMerged(`npx wrangler d1 migrations apply ${binding}${envFlag} --remote`);
    // Print only the last meaningful line to avoid noise
    const lines = output.trim().split("\n").filter(Boolean);
    if (lines.length > 0) console.log(`    ${lines[lines.length - 1]}`);
  } catch (err) {
    // Migration errors are non-fatal if tables already exist
    console.warn(`  Warning: migration command exited non-zero (tables may already exist)`);
    if (err instanceof Error) {
      const msg = err.message.split("\n")[0];
      console.warn(`    ${msg}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prodOnly = args.includes("--prod");
  const stagingOnly = args.includes("--staging");

  const doProd = !stagingOnly;
  const doStaging = !prodOnly;

  console.log("D1 setup\n");

  if (doProd) {
    console.log("── Production ───────────────────────────────────────────");
    const prodId = findOrCreate(PROD_DB_NAME);
    patchWranglerToml(PROD_PLACEHOLDER, prodId);
    applyMigrations("APP_DB");
    console.log();
  }

  if (doStaging) {
    console.log("── Staging ──────────────────────────────────────────────");
    const stagingId = findOrCreate(STAGING_DB_NAME);
    patchWranglerToml(STAGING_PLACEHOLDER, stagingId);
    applyMigrations("APP_DB", "staging");
    console.log();
  }

  console.log("Done. wrangler.toml is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
