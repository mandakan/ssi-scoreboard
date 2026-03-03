# Release Post Generator

After each deployment, two scripts automate the social media post and app screenshots:

- **`scripts/generate-release-post.ts`** — diffs releases since the last deploy, builds a
  Swedish or English Facebook post draft, and optionally triggers the screenshot helper.
- **`scripts/screenshot-match.ts`** — Playwright helper that captures canonical app scenes at
  mobile and desktop viewports, using rich anonymized mock data by default.

---

## Quick start

```bash
# 1. Make sure the dev server is running (only needed for --screenshots)
pnpm dev

# 2. Generate a Swedish post draft (auto-detects last deploy via gh CLI)
pnpm release:post

# 3. Generate post + screenshots with mock data (no live match needed)
pnpm release:post --screenshots

# 4. Review and edit the output
open release-assets/post.txt
open release-assets/          # PNG screenshots
```

Output lands in `./release-assets/` by default. Both files are gitignored — they are
reviewed locally and never committed.

---

## Deploy detection

The script calls:

```
gh run list --workflow=deploy-cloudflare.yml --status=success --limit=1 --json createdAt
```

It extracts the `createdAt` date and finds all `RELEASES` entries with an `id` strictly
greater than that date (lexicographic comparison, handles `b`/`c` suffixes correctly).

If `gh` is unavailable or no successful runs are found, it falls back to using the
second-newest release as the cutoff and warns you to use `--since` instead.

---

## CLI flags

### `generate-release-post.ts`

| Flag | Default | Description |
|---|---|---|
| `--lang sv\|en` | `sv` | Language for post headings and boilerplate |
| `--since <release-id>` | auto-detected | Override deploy cutoff, e.g. `2026-02-28` |
| `--match-url <url>` | — | SSI match URL for live screenshots (omit = mock data) |
| `--output <dir>` | `./release-assets` | Output directory for `post.txt` and PNGs |
| `--screenshots` | off | Also run the screenshot helper |

### `screenshot-match.ts`

| Flag | Default | Description |
|---|---|---|
| `--output <dir>` | `./release-assets` | Where to write PNGs and `manifest.json` |
| `--match-url <url>` | — | SSI match URL; omit to use mock data |
| `--scenes <name,...>` | all scenes | Comma-separated subset of scene names to capture |
| `--competitors <id,...>` | — | Competitor IDs to pre-select (only with `--match-url`) |

---

## Scene catalogue

Every scene is captured at both **mobile** (390×844) and **desktop** (1280×900), producing
`{scene}-mobile.png` and `{scene}-desktop.png`.

| Scene name | What it shows |
|---|---|
| `comparison-table` | Full comparison table |
| `degradation-chart` | Stage degradation chart with Spearman r badge |
| `hf-level-bars` | HF Level bars |
| `archetype-chart` | Archetype performance breakdown |
| `style-fingerprint` | Style fingerprint scatter chart |
| `shooter-dashboard` | Shooter dashboard with match history and trend charts |
| `competitor-identity` | Competitor picker open showing identity and tracked star states |
| `tracked-shooters-sheet` | My shooters management sheet |
| `whats-new-dialog` | What's New dialog open |

The script writes `manifest.json` alongside the PNGs listing each scene name, description,
and the filenames keyed by viewport tag (`mobile`/`desktop`).

---

## Mock data vs live data

**Mock data (default):** `scripts/release-mock-data.ts` provides a fictional Level III match
("Västra Regionmatch 2026") with 3 generic competitors (A. Lindström, B. Holm, C. Berg), 6
stages covering speed/precision/mixed archetypes, and all analytics populated — degradation
data with a significant Spearman r, style fingerprint cloud, what-if scenarios, etc.

No dev server is required for the post text itself. Screenshots require `pnpm dev` running at
`http://localhost:3000` so the Next.js app can serve the pages.

**Live data (`--match-url`):** pass any SSI match URL to navigate to real data. You review
the screenshots before publishing, so this is safe — no personal data is shared automatically.

```bash
pnpm release:post --screenshots --match-url https://shootnscoreit.com/event/22/12345/
```

---

## `screenshotScenes` on releases

Each `Release` entry in `lib/releases.ts` has an optional `screenshotScenes` array that maps
the release to the most relevant scenes from the catalogue above. When `--screenshots` is
passed, the script captures the scenes listed on the newest release in the detected diff.
If `screenshotScenes` is omitted, all scenes are captured as a fallback.

When adding a new release entry, include a `screenshotScenes` array that highlights the
key new features. See CLAUDE.md → "What's New dialog" for the rule of thumb.

---

## Examples

```bash
# Post only, auto-detect deploy, Swedish
pnpm release:post

# Post + screenshots, English, explicit cutoff
pnpm release:post --lang en --since 2026-02-28 --screenshots

# Post + screenshots with a live match URL
pnpm release:post --screenshots --match-url https://shootnscoreit.com/event/22/12345/

# Screenshots only, specific scenes
pnpm release:screenshots --scenes comparison-table-mobile,whats-new-dialog

# Screenshots only, all scenes, custom output dir
pnpm release:screenshots --output ~/Desktop/release-2026-03-03
```
