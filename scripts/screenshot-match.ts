#!/usr/bin/env node
/**
 * Playwright screenshot helper for release assets.
 *
 * Captures anonymized app screenshots for use in Facebook/social posts.
 * Can use real match data (--match-url) or rich mock data (default).
 *
 * Every scene is captured at both mobile (390×844) and desktop (1280×900),
 * producing {scene}-mobile.png and {scene}-desktop.png.
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
 *   comparison-table      Full comparison table
 *   degradation-chart     Stage degradation chart with Spearman r badge
 *   hf-level-bars         HF Level bars
 *   archetype-chart       Archetype performance breakdown
 *   style-fingerprint     Style fingerprint scatter chart
 *   shooter-dashboard     Shooter dashboard with match history and trend charts
 *   competitor-identity   Competitor picker open showing identity + tracked star states
 *   tracked-shooters-sheet  My shooters management sheet
 *   whats-new-dialog      What's New dialog open
 */

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { MOCK_MATCH, MOCK_COMPARE, MOCK_SHOOTER, MOCK_SHOOTER_ID } from "./release-mock-data";
import { LATEST_RELEASE_ID } from "../lib/releases";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Standard viewports ────────────────────────────────────────────────────────

const VIEWPORTS = [
  { tag: "mobile",  width: 390,  height: 844 },
  { tag: "desktop", width: 1280, height: 900 },
] as const;

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
  /** Whether to suppress the What's New dialog (false = let it show, for the dialog scene). */
  suppressWhatsNew: boolean;
  /** Called after page is ready to navigate and wait for relevant content. */
  setup: (page: import("@playwright/test").Page, matchPath: string) => Promise<void>;
}

// Mock competitor IDs from release-mock-data.ts
const MOCK_IDS = "1001,1002,1003";

/**
 * Expand the "Coaching analysis" accordion (idempotent).
 * The accordion starts collapsed; its content only mounts when open.
 */
async function openCoachingSection(page: import("@playwright/test").Page): Promise<void> {
  const btn = page.locator('button[aria-controls="coaching-view-panel"]');
  await btn.waitFor({ timeout: 8000 }).catch(() => null);
  const expanded = await btn.getAttribute("aria-expanded").catch(() => null);
  if (expanded !== "true") {
    await btn.click().catch(() => null);
    // Wait for the section to mount in the DOM
    await page.locator("#coaching-view-panel").waitFor({ timeout: 5000 }).catch(() => null);
  }
}

const SCENES: Scene[] = [
  {
    name: "comparison-table",
    description: "Full comparison table",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("table", { timeout: 10000 });
      await page.locator("text=Stage results").evaluate(
        (el) => el.scrollIntoView({ block: "start", behavior: "instant" })
      );
    },
  },
  {
    name: "degradation-chart",
    description: "Stage degradation chart with Spearman r badge",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      await openCoachingSection(page);
      const heading = page.locator("h3", { hasText: "Stage degradation" }).first();
      await heading.waitFor({ timeout: 8000 }).catch(() => null);
      // scrollIntoView block:start puts the heading at the viewport top so the
      // chart renders below it rather than the heading appearing at the bottom edge.
      await heading.evaluate(
        (el) => el.scrollIntoView({ block: "start", behavior: "instant" })
      ).catch(() => null);
    },
  },
  {
    name: "hf-level-bars",
    description: "HF Level bars in stage rows of the comparison table",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("table", { timeout: 10000 });
      // HF Level bars are the difficulty indicators in each stage row.
      // Centering the first bar keeps the table column headers in view above
      // and shows several rows with bars below — distinguishable from comparison-table.
      const hfBar = page.locator('[aria-label^="HF Level"]').first();
      await hfBar.waitFor({ timeout: 10000 }).catch(() => null);
      await hfBar.evaluate(
        (el) => el.scrollIntoView({ block: "center", behavior: "instant" })
      ).catch(() => null);
    },
  },
  {
    name: "archetype-chart",
    description: "Stage archetype breakdown (Speed / Precision / Mixed)",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      await openCoachingSection(page);
      const heading = page.locator("h3", { hasText: "Stage archetype breakdown" }).first();
      await heading.waitFor({ timeout: 8000 }).catch(() => null);
      await heading.evaluate(
        (el) => el.scrollIntoView({ block: "start", behavior: "instant" })
      ).catch(() => null);
    },
  },
  {
    name: "style-fingerprint",
    description: "Style fingerprint scatter chart",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("text=Stage results", { timeout: 10000 });
      await openCoachingSection(page);
      const heading = page.locator("h3", { hasText: "Shooter style fingerprint" }).first();
      await heading.waitFor({ timeout: 8000 }).catch(() => null);
      await heading.evaluate(
        (el) => el.scrollIntoView({ block: "start", behavior: "instant" })
      ).catch(() => null);
    },
  },
  {
    name: "shooter-dashboard",
    description: "Shooter dashboard with match history and performance trends",
    suppressWhatsNew: true,
    setup: async (page) => {
      // Mock the shooter API — always uses mock data regardless of --match-url
      await page.route(`/api/shooter/${MOCK_SHOOTER_ID}`, (route) =>
        route.fulfill({ json: MOCK_SHOOTER })
      );
      await page.goto(`/shooter/${MOCK_SHOOTER_ID}`);
      // Wait for the identity card (h1) and at least one match card to render
      await page.waitForSelector("h1", { timeout: 10000 });
      await page.waitForSelector('[aria-labelledby="history-heading"]', { timeout: 8000 }).catch(() => null);
    },
  },
  {
    name: "competitor-identity",
    description: "Competitor picker open showing 'This is me' identity and tracked star states",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      // Pre-seed identity (A. Lindström) and one tracked competitor (B. Holm)
      // so the picker shows the active identity/star icon states.
      await page.addInitScript(() => {
        localStorage.setItem(
          "ssi-my-shooter",
          JSON.stringify({ shooterId: 12345, name: "A. Lindström", license: null })
        );
        localStorage.setItem(
          "ssi-tracked-shooters",
          JSON.stringify([
            { shooterId: 12346, name: "B. Holm", club: "Malmö SKF", division: "Production" },
          ])
        );
      });
      await page.goto(matchPath);
      // Wait for the page to load, then open the competitor picker
      const addBtn = page.locator("button", { hasText: "Add competitor" });
      await addBtn.waitFor({ timeout: 10000 }).catch(() => null);
      await addBtn.click().catch(() => null);
      // Wait for identity buttons to appear in the picker rows
      await page
        .locator('button[aria-label*="Set as my identity"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => null);
    },
  },
  {
    name: "tracked-shooters-sheet",
    description: "My shooters management sheet with identity and tracked competitors listed",
    suppressWhatsNew: true,
    setup: async (page, matchPath) => {
      // Pre-seed identity (A. Lindström) and two tracked competitors (B. Holm, C. Berg)
      await page.addInitScript(() => {
        localStorage.setItem(
          "ssi-my-shooter",
          JSON.stringify({ shooterId: 12345, name: "A. Lindström", license: null })
        );
        localStorage.setItem(
          "ssi-tracked-shooters",
          JSON.stringify([
            { shooterId: 12346, name: "B. Holm", club: "Malmö SKF", division: "Production" },
            { shooterId: 12347, name: "C. Berg", club: "Stockholms PK", division: "Production" },
          ])
        );
      });
      await page.goto(`${matchPath}?competitors=${MOCK_IDS}`);
      await page.waitForSelector("table", { timeout: 10000 });
      // Open the "My shooters" sheet via the footer identity button
      const identityBtn = page.locator('button[aria-label*="Your identity"]').first();
      await identityBtn.waitFor({ timeout: 8000 }).catch(() => null);
      await identityBtn.click().catch(() => null);
      // Wait for the bottom sheet to open
      await page.locator("text=My shooters").first().waitFor({ timeout: 5000 }).catch(() => null);
    },
  },
  {
    name: "whats-new-dialog",
    description: "What's New dialog open",
    suppressWhatsNew: false, // dialog scene — let it auto-show
    setup: async (page, matchPath) => {
      void matchPath; // dialog scene navigates to home page, not match
      await page.goto("/");
      // The What's New dialog auto-shows because we did NOT suppress it.
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ timeout: 8000 }).catch(async () => {
        // Fallback: trigger via footer link
        await page.locator("text=What's new").first().click().catch(() => null);
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
  let matchPath: string;
  let useMockData: boolean;

  if (args.matchUrl) {
    const parsed = parseSsiUrl(args.matchUrl);
    if (!parsed) {
      console.error(`Cannot parse SSI match URL: ${args.matchUrl}`);
      console.error("Expected format: https://shootnscoreit.com/event/22/12345/");
      process.exit(1);
    }
    matchPath = `/match/${parsed.ct}/${parsed.id}`;
    useMockData = false;
    console.log(`Mode: LIVE  →  http://localhost:3000${matchPath}`);
    console.log("Note: dev server must be running at http://localhost:3000");
  } else {
    matchPath = `/match/22/88888888`;
    useMockData = true;
    console.log("Mode: MOCK  (rich anonymized data, no live API needed)");
    console.log("Note: dev server must be running at http://localhost:3000");
  }

  console.log(`Output:      ${outputDir}`);
  console.log(`Scenes:      ${scenes.map((s) => s.name).join(", ")}`);
  console.log(`Viewports:   ${VIEWPORTS.map((v) => `${v.tag} (${v.width}×${v.height})`).join(", ")}`);
  console.log("");

  const browser = await chromium.launch({ headless: true });

  const manifest: Array<{
    scene: string;
    description: string;
    files: Record<string, string>;
  }> = [];

  for (const scene of scenes) {
    console.log(`Capturing: ${scene.name} …`);
    const files: Record<string, string> = {};

    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        baseURL: "http://localhost:3000",
      });
      const page = await context.newPage();

      // ── Suppress first-visit modals via localStorage ─────────────────────
      // Must run before app scripts (addInitScript fires before page scripts).
      await page.addInitScript(
        ({
          releaseId,
          suppressWhatsNew,
        }: {
          releaseId: string;
          suppressWhatsNew: boolean;
        }) => {
          localStorage.setItem("ssi-cell-help-seen", "1");
          if (suppressWhatsNew) {
            localStorage.setItem("whats-new-seen-id", releaseId);
          }
        },
        { releaseId: LATEST_RELEASE_ID, suppressWhatsNew: scene.suppressWhatsNew }
      );

      // ── Mock API routes (mock mode only) ─────────────────────────────────
      if (useMockData) {
        await page.route("/api/match/22/88888888", (route) =>
          route.fulfill({ json: MOCK_MATCH })
        );
        await page.route(/\/api\/compare/, (route) =>
          route.fulfill({ json: MOCK_COMPARE })
        );
      }

      // ── Run scene setup ──────────────────────────────────────────────────
      try {
        await scene.setup(page, matchPath);

        // Remove Next.js dev overlay after the page has settled.
        // addInitScript CSS injection fires too early (before nextjs-portal mounts),
        // so we remove the element from the DOM here instead.
        await page.evaluate(() => {
          document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
        }).catch(() => null);

        // Give charts a moment to finish rendering
        await page.waitForTimeout(1200);
      } catch (err) {
        console.warn(`  Warning [${vp.tag}]: ${err instanceof Error ? err.message : err}`);
      }

      // ── Capture screenshot ───────────────────────────────────────────────
      const filename = `${scene.name}-${vp.tag}.png`;
      await page.screenshot({ path: join(outputDir, filename), fullPage: false });
      files[vp.tag] = filename;
      console.log(`  ✓ ${filename}`);

      await context.close();
    }

    manifest.push({ scene: scene.name, description: scene.description, files });
  }

  await browser.close();

  // ── Write manifest ─────────────────────────────────────────────────────────
  const manifestPath = join(outputDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ manifest.json written`);
  console.log(`\n${scenes.length * VIEWPORTS.length} screenshot(s) saved to: ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
