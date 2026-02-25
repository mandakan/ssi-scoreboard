/**
 * Generates social-preview.png (1280×640) for GitHub repository settings.
 *
 * Content is pulled dynamically from project sources:
 *   - Logo:    public/logo-dark.svg
 *   - Name:    public/manifest.json  → .name
 *   - Tagline: public/manifest.json  → .description
 *
 * Layout is defined in scripts/social-preview.html (placeholders replaced below).
 *
 * Usage:
 *   pnpm social-preview
 *   node scripts/generate-social-preview.mjs
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── Read source files ──────────────────────────────────────────────────────

const iconSvg = readFileSync(resolve(root, "public/logo-dark.svg"), "utf8")
  // Strip the XML declaration — not valid inside HTML
  .replace(/<\?xml[^?]*\?>\s*/i, "")
  .trim();

const manifest = JSON.parse(
  readFileSync(resolve(root, "public/manifest.json"), "utf8")
);

const appName = manifest.name ?? "SSI Scoreboard";
// Split "SSI Scoreboard" → prefix="SSI", suffix="Scoreboard"
// Splits on the first space so "My App Name" → "My" / "App Name"
const spaceIndex = appName.indexOf(" ");
const namePrefx = spaceIndex === -1 ? appName : appName.slice(0, spaceIndex);
const nameSuffix = spaceIndex === -1 ? "" : appName.slice(spaceIndex + 1);

const tagline = manifest.description ?? "";

// ── Build HTML from template ───────────────────────────────────────────────

const template = readFileSync(
  resolve(__dirname, "social-preview.html"),
  "utf8"
);

const html = template
  .replace("__ICON_SVG__", iconSvg)
  .replace("__APP_NAME_PREFIX__", namePrefx)
  .replace("__APP_NAME_SUFFIX__", nameSuffix)
  .replace("__TAGLINE__", tagline);

// ── Render with Playwright ─────────────────────────────────────────────────

const outPath = resolve(root, "social-preview.png");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 640 });

// Load from data URI so no file-server is needed and relative asset paths
// (the Google Fonts <link>) still resolve correctly over the network.
await page.setContent(html, { waitUntil: "networkidle" });

await page.screenshot({ path: outPath });
await browser.close();

console.log(`✓ social-preview.png written to ${outPath}`);
console.log(`  Name:    ${appName}`);
console.log(`  Tagline: ${tagline}`);
console.log(`  Icon:    public/logo-dark.svg`);
