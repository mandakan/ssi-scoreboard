#!/usr/bin/env node
/**
 * Playwright screenshot helper for release assets.
 *
 * Captures anonymized app screenshots for use in Facebook/social posts.
 * Can use real match data (--match-url) or rich mock data (default).
 *
 * Usage:
 *   pnpm release:screenshots [options]
 *   tsx scripts/screenshot-match.ts [options]
 *
 * Options:
 *   --output <dir>              Output directory (default: ./release-assets)
 *   --match-url <url>           SSI match URL for live screenshots (omit = mock data)
 *   --scenes <name,name,...>    Capture only these scenes (omit = all scenes)
 *   --competitors <id,id,...>   Competitor IDs to pre-select (only with --match-url)
 *
 * Scene catalogue:
 *   comparison-table-mobile    Full comparison table at 390×844 (mobile)
 *   comparison-table-desktop   Full comparison table at 1280×900 (desktop)
 *   degradation-chart          Stage degradation chart at 1280×600
 *   hf-level-bars              HF level bars at 390×500
 *   archetype-chart            Archetype performance at 1280×600
 *   style-fingerprint          Style fingerprint scatter at 1280×600
 *   whats-new-dialog           What's New dialog open at 390×844
 */

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { MOCK_MATCH, MOCK_COMPARE } from "./release-mock-data";
import { LATEST_RELEASE_ID } from "../lib/releases";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI argument parser ────────────────────────────────────────────────────────

interface CliArgs {
  output: string;
  matchUrl: string | null;
  scenes: string[] | null;  // null = all scenes
  competitors: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };

  const scenesRaw = get("--scenes");
  return {
    output: get("--output") ?? join(ROOT, "release-assets"),
    matchUrl: get("--match-url"),
    scenes: scenesRaw ? scenesRaw.split(",").map((s) => s.trim()) : null,
    competitors: get("--competitors"),
  };
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Parse an SSI match URL like https://shootnscoreit.com/event/22/12345/
 * Returns { ct, id } for use in the app route.
 */
function parseSsiUrl(url: string): { ct: string; id: string } | null {
  const match = url.match(/\/event\/(\d+)\/(\d+)\/?$/);
  if (!match) return null;
  return { ct: match[1], id: match[2] };
}

// ── Scene catalogue ───────────────────────────────────────────────────────────

interface Scene {
  name: string;
  description: string;
  viewport: { width: number; height: number };
  /** Called after page is ready to set up the scene and wait for content. */
  setup: (page: import("@playwright/test").Page, matchPath: string) => Promise<void>;
}

// Mock competitor IDs from release-mock-data.ts
const MOCK_IDS = "1001,1002,1003";

const SCENES: Scene[] = [
  {
    name: "comparison-table-mobile",
    description: "Full comparison table, mobile (390×844)",
    viewport: { width: 390, height: 844 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("table", { timeout: 10000 });
      // Scroll to the table
      await page.locator("text=Stage results").scrollIntoViewIfNeeded();
    },
  },
  {
    name: "comparison-table-desktop",
    description: "Full comparison table, desktop (1280×900)",
    viewport: { width: 1280, height: 900 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("table", { timeout: 10000 });
      await page.locator("text=Stage results").scrollIntoViewIfNeeded();
    },
  },
  {
    name: "degradation-chart",
    description: "Stage degradation chart with Spearman r badge (1280×600)",
    viewport: { width: 1280, height: 600 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      // Wait for page load then scroll to degradation section
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      // The degradation chart section
      const heading = page.locator("text=Stage degradation").first();
      await heading.waitFor({ timeout: 10000 }).catch(() => null);
      await heading.scrollIntoViewIfNeeded().catch(() => null);
    },
  },
  {
    name: "hf-level-bars",
    description: "HF level bars with field accuracy, mobile (390×500)",
    viewport: { width: 390, height: 500 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      // Scroll to the HF chart section
      const heading = page.locator("text=Hit factor by stage").first();
      await heading.waitFor({ timeout: 10000 }).catch(() => null);
      await heading.scrollIntoViewIfNeeded().catch(() => null);
    },
  },
  {
    name: "archetype-chart",
    description: "Archetype performance breakdown (1280×600)",
    viewport: { width: 1280, height: 600 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      const heading = page.locator("text=Archetype").first();
      await heading.waitFor({ timeout: 10000 }).catch(() => null);
      await heading.scrollIntoViewIfNeeded().catch(() => null);
    },
  },
  {
    name: "style-fingerprint",
    description: "Style fingerprint scatter chart (1280×600)",
    viewport: { width: 1280, height: 600 },
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      const heading = page.locator("text=Style fingerprint").first();
      await heading.waitFor({ timeout: 10000 }).catch(() => null);
      await heading.scrollIntoViewIfNeeded().catch(() => null);
    },
  },
  {
    name: "whats-new-dialog",
    description: "What's New dialog open, mobile (390×844)",
    viewport: { width: 390, height: 844 },
    setup: async (page, matchPath) => {
      void matchPath; // dialog scene navigates to home page, not match
      await page.goto("/");
      // The What's New dialog auto-shows because we did NOT suppress it in localStorage
      // (we only suppress the cell-help tooltip). Wait for it to appear.
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ timeout: 8000 }).catch(async () => {
        // Fallback: trigger via footer link
        const link = page.locator("text=What's new").first();
        await link.click().catch(() => null);
      });
      await dialog.waitFor({ timeout: 5000 }).catch(() => null);
    },
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  // Resolve output directory
  const outputDir = resolve(args.output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Determine which scenes to capture
  const scenes = args.scenes
    ? SCENES.filter((s) => args.scenes!.includes(s.name))
    : SCENES;

  if (scenes.length === 0) {
    console.error(`No matching scenes found. Available: ${SCENES.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  // Determine app base URL and match path
  const baseUrl = "http://localhost:3000";
  let matchPath: string;
  let useMockData: boolean;

  if (args.matchUrl) {
    const parsed = parseSsiUrl(args.matchUrl);
    if (!parsed) {
      console.error(`Cannot parse SSI match URL: ${args.matchUrl}`);
      console.error("Expected format: https://shootnscoreit.com/event/22/12345/");
      process.exit(1);
    }
    matchPath = `${baseUrl}/match/${parsed.ct}/${parsed.id}`;
    if (args.competitors) {
      // competitors will be appended as query param in each scene's setup
      matchPath = matchPath; // scenes add ?competitors= themselves
    }
    useMockData = false;
    console.log(`Mode: LIVE  →  ${matchPath}`);
    console.log("Note: dev server must be running at http://localhost:3000");
  } else {
    matchPath = `${baseUrl}/match/22/88888888`;
    useMockData = true;
    console.log("Mode: MOCK  (rich anonymized data, no live API needed)");
    console.log("Note: dev server must be running at http://localhost:3000");
  }

  console.log(`Output:      ${outputDir}`);
  console.log(`Scenes:      ${scenes.map((s) => s.name).join(", ")}`);
  console.log("");

  const browser = await chromium.launch({ headless: true });

  const manifest: Array<{
    scene: string;
    file: string;
    description: string;
    viewport: { width: number; height: number };
  }> = [];

  for (const scene of scenes) {
    console.log(`Capturing: ${scene.name} …`);

    const context = await browser.newContext({
      viewport: scene.viewport,
      baseURL: "http://localhost:3000",
    });
    const page = await context.newPage();

    // ── Suppress help dialogs ──────────────────────────────────────────────
    // Always suppress the cell-help tooltip. For the whats-new-dialog scene,
    // do NOT suppress the What's New dialog (that IS the scene).
    await page.addInitScript(
      ({ releaseId, suppressWhatsNew }: { releaseId: string; suppressWhatsNew: boolean }) => {
        localStorage.setItem("ssi-cell-help-seen", "1");
        if (suppressWhatsNew) {
          localStorage.setItem("whats-new-seen-id", releaseId);
        }
      },
      {
        releaseId: LATEST_RELEASE_ID,
        suppressWhatsNew: scene.name !== "whats-new-dialog",
      }
    );

    // ── Mock API routes (mock mode only) ──────────────────────────────────
    if (useMockData) {
      await page.route("/api/match/22/88888888", (route) =>
        route.fulfill({ json: MOCK_MATCH })
      );
      await page.route(/\/api\/compare/, (route) =>
        route.fulfill({ json: MOCK_COMPARE })
      );
    }

    // ── Run scene setup ────────────────────────────────────────────────────
    try {
      await scene.setup(page, matchPath);
      // Give charts a moment to render
      await page.waitForTimeout(1200);
    } catch (err) {
      console.warn(`  Warning during setup: ${err instanceof Error ? err.message : err}`);
    }

    // ── Capture screenshot ─────────────────────────────────────────────────
    const filename = `${scene.name}.png`;
    const filePath = join(outputDir, filename);
    await page.screenshot({ path: filePath, fullPage: false });

    manifest.push({
      scene: scene.name,
      file: filename,
      description: scene.description,
      viewport: scene.viewport,
    });

    console.log(`  ✓ ${filename}`);
    await context.close();
  }

  await browser.close();

  // ── Write manifest ─────────────────────────────────────────────────────────
  const manifestPath = join(outputDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ manifest.json written`);
  console.log(`\n${scenes.length} screenshot(s) saved to: ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
