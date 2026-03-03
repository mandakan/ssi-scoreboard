#!/usr/bin/env node
/**
 * Release post generator.
 *
 * Detects what shipped since the last deploy, builds a ready-to-edit Facebook
 * post draft, and optionally takes app screenshots.
 *
 * Usage:
 *   pnpm release:post [options]
 *   tsx scripts/generate-release-post.ts [options]
 *
 * Options:
 *   --lang sv|en           Post language (default: sv)
 *   --since <release-id>   Override deploy detection (e.g. "2026-02-28")
 *   --match-url <url>      SSI match URL for live screenshots (omit = mock data)
 *   --output <dir>         Output directory (default: ./release-assets)
 *   --screenshots          Also take app screenshots
 */

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { RELEASES } from "../lib/releases";
import type { Release } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── .env.local loader ─────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ── CLI argument parser ────────────────────────────────────────────────────────

interface CliArgs {
  lang: "sv" | "en";
  since: string | null;
  matchUrl: string | null;
  output: string;
  screenshots: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const langRaw = get("--lang") ?? "sv";
  if (langRaw !== "sv" && langRaw !== "en") {
    console.error(`Invalid --lang value "${langRaw}". Use "sv" or "en".`);
    process.exit(1);
  }

  return {
    lang: langRaw as "sv" | "en",
    since: get("--since"),
    matchUrl: get("--match-url"),
    output: get("--output") ?? join(ROOT, "release-assets"),
    screenshots: has("--screenshots"),
  };
}

// ── Deploy detection via gh CLI ───────────────────────────────────────────────

/**
 * Returns the ISO timestamp of the most recent successful deploy, or null
 * if gh is unavailable or no runs are found.
 */
function detectLastDeployDate(): string | null {
  try {
    const output = execSync(
      "gh run list --workflow=deploy-cloudflare.yml --status=success --limit=1 --json createdAt,headBranch",
      { cwd: ROOT, timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const runs = JSON.parse(output) as Array<{ createdAt: string; headBranch: string }>;
    if (!runs.length) return null;
    return runs[0].createdAt; // ISO timestamp
  } catch {
    return null;
  }
}

// ── Release diffing ───────────────────────────────────────────────────────────

/**
 * Find all releases newer than the given cutoff id (lexicographic comparison).
 * E.g. cutoff "2026-02-28" → includes "2026-02-28b", "2026-03-01", "2026-03-03".
 */
function getReleasesNewerThan(cutoffId: string): Release[] {
  return RELEASES.filter((r) => r.id > cutoffId);
}

/**
 * Derive a release-id cutoff from a full ISO timestamp.
 * "2026-03-03T14:22:00Z" → "2026-03-03"
 */
function isoToReleaseId(iso: string): string {
  return iso.slice(0, 10);
}

// ── Post text generation ──────────────────────────────────────────────────────

const SECTION_HEADING_MAP: Record<string, { sv: string; en: string }> = {
  New:      { sv: "Nytt",        en: "New"      },
  Improved: { sv: "Förbättrat",  en: "Improved" },
  Fixed:    { sv: "Fixat",       en: "Fixed"    },
};

function mapHeading(heading: string, lang: "sv" | "en"): string {
  return SECTION_HEADING_MAP[heading]?.[lang] ?? heading;
}

function buildPostText(releases: Release[], lang: "sv" | "en"): string {
  const lines: string[] = [];

  if (lang === "sv") {
    lines.push("Nytt i SSI Scoreboard 🎯");
    lines.push("");
    if (releases.length === 1) {
      lines.push(`Rullar ut en ny version nu med:`);
    } else {
      lines.push(`Ny version ute — här är vad som har förändrats sedan sist:`);
    }
  } else {
    lines.push("New in SSI Scoreboard 🎯");
    lines.push("");
    if (releases.length === 1) {
      lines.push("Shipping a new release:");
    } else {
      lines.push("New version out — here's what's changed:");
    }
  }

  for (const release of releases) {
    // Add release title as sub-heading if there are multiple releases
    if (releases.length > 1 && release.title) {
      lines.push("");
      lines.push(`--- ${release.date}${release.title ? `: ${release.title}` : ""} ---`);
    }

    for (const section of release.sections) {
      lines.push("");
      lines.push(`${mapHeading(section.heading, lang)}:`);
      for (const item of section.items) {
        lines.push(`• ${item}`);
      }
    }
  }

  lines.push("");

  if (lang === "sv") {
    lines.push("Testa på https://scoreboard.urdr.dev — ingen inloggning krävs, hitta ett match på ShootNScoreIt och klistra in länken. 🔗");
  } else {
    lines.push("Try it at https://scoreboard.urdr.dev — no login needed, find a match on ShootNScoreIt and paste the link. 🔗");
  }

  return lines.join("\n");
}

// ── Screenshot runner ─────────────────────────────────────────────────────────

function runScreenshots(args: CliArgs, scenes: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptArgs = [
      "scripts/screenshot-match.ts",
      "--output", args.output,
    ];

    if (args.matchUrl) {
      scriptArgs.push("--match-url", args.matchUrl);
    }

    if (scenes.length > 0) {
      scriptArgs.push("--scenes", scenes.join(","));
    }

    console.log(`\nRunning screenshots: tsx ${scriptArgs.join(" ")}`);

    const child = spawn("npx", ["tsx", ...scriptArgs], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Screenshot script exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));

  const args = parseArgs();

  // ── Resolve output directory ───────────────────────────────────────────────
  const outputDir = resolve(args.output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // ── Detect since cutoff ────────────────────────────────────────────────────
  let cutoffId: string;

  if (args.since) {
    cutoffId = args.since;
    console.log(`Since cutoff : ${cutoffId}  (from --since flag)`);
  } else {
    const deployTs = detectLastDeployDate();
    if (deployTs) {
      cutoffId = isoToReleaseId(deployTs);
      console.log(`Last deploy  : ${deployTs}`);
      console.log(`Since cutoff : ${cutoffId}  (auto-detected)`);
    } else {
      // Fall back to the second-newest release as cutoff
      const fallbackCutoff = RELEASES.length > 1 ? RELEASES[1].id : RELEASES[0].id;
      cutoffId = fallbackCutoff;
      console.warn(`Warning: could not detect last deploy (gh CLI unavailable or no runs found).`);
      console.warn(`Falling back to second-newest release as cutoff: ${cutoffId}`);
      console.warn(`Use --since <release-id> to override.`);
    }
  }

  // ── Find new releases ──────────────────────────────────────────────────────
  const newReleases = getReleasesNewerThan(cutoffId);

  if (newReleases.length === 0) {
    console.log(`\nNo releases found newer than "${cutoffId}".`);
    console.log("Use --since <older-release-id> to include more releases.");
    process.exit(0);
  }

  console.log(`\nNew releases since ${cutoffId}:`);
  for (const r of newReleases) {
    console.log(`  ${r.id}  ${r.title ?? "(no title)"}`);
  }

  // ── Generate post text ─────────────────────────────────────────────────────
  const postText = buildPostText(newReleases, args.lang);

  console.log("\n" + "─".repeat(60));
  console.log("POST TEXT:");
  console.log("─".repeat(60));
  console.log(postText);
  console.log("─".repeat(60));

  // ── Write post.txt ─────────────────────────────────────────────────────────
  const postPath = join(outputDir, "post.txt");
  writeFileSync(postPath, postText, "utf-8");
  console.log(`\n✓ post.txt written to ${postPath}`);

  // ── Optionally take screenshots ────────────────────────────────────────────
  if (args.screenshots) {
    // Collect scene names from the newest release's screenshotScenes,
    // or fall back to all scenes.
    const newestRelease = newReleases[0];
    const scenes = newestRelease.screenshotScenes ?? [];

    try {
      await runScreenshots(args, scenes);
      console.log(`\n✓ Screenshots saved to ${outputDir}`);
    } catch (err) {
      console.error(`\nScreenshot step failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  } else {
    console.log("\nTip: add --screenshots to also capture app screenshots.");
  }

  console.log("\nDone. Review post.txt and screenshots before publishing.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
