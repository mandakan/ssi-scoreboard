# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repo.

For deeper background on a topic, follow the pointer to the matching `docs/*.md` file.

## Dev Commands
```bash
pnpm dev              # start Next.js dev server (port 3000)
pnpm build            # production build
pnpm -w run lint      # ESLint (eslint .) -- zero warnings required
pnpm -w run typecheck # tsc --noEmit -- zero errors required
pnpm -w test          # vitest run (unit + component)
pnpm test:watch       # vitest watch mode
pnpm test:e2e         # playwright test (mocked API, no live key needed)
pnpm test:e2e:ui      # playwright --ui
cd mcp && pnpm run typecheck  # typecheck the MCP stdio server
```

**All checks must pass cleanly:** `pnpm -w run typecheck && pnpm -w test` must produce zero
errors and zero warnings before committing. `pnpm -w run lint` must also produce zero warnings.

Note: use `pnpm -w` to target the workspace root (required since `mcp/` is a workspace package
and doesn't define its own `lint`/`typecheck`/`test` scripts that match the root ones).

## Architecture

Next.js 16 full-stack app. Route Handlers in `app/api/` are the only place that call
the ShootNScoreIt GraphQL API -- the `SSI_API_KEY` lives in `.env.local` and must never
be referenced from any file with `"use client"` or any file under `lib/` that is imported
by client components.

```
Browser -> Next.js Route Handlers -> shootnscoreit.com/graphql/
```

Key directories:
- `app/api/match/[ct]/[id]/route.ts` -- proxies match overview query
- `app/api/compare/route.ts` -- fans out competitor scorecard queries, calls logic.ts
- `app/api/compare/logic.ts` -- **pure function** `computeGroupRankings()`, no I/O, fully unit-tested
- `app/api/mcp/route.ts` -- MCP HTTP endpoint (JSON-RPC, single-shot transport); optional `MCP_SECRET` bearer auth
- `lib/graphql.ts` -- GQL query strings + `executeQuery()`, server-only (no NEXT_PUBLIC_ prefix)
- `lib/cache.ts` -- `CacheAdapter` interface (get/set/persist/del/expire/scanCachedMatchKeys)
- `lib/cache-node.ts` -- ioredis implementation (Docker / Node.js target)
- `lib/cache-edge.ts` -- @upstash/redis HTTP implementation (Cloudflare Pages target)
- `lib/cache-impl.ts` -- re-exports node adapter by default; CF builds override via webpack alias
- `lib/db.ts` -- `AppDatabase` interface (persistent shooter profiles, match indices, popularity tracking, achievements, match data cache)
- `lib/db-migrations.ts` -- shared migration definitions + runtime runner (single source of truth for schema)
- `lib/db-sqlite.ts` -- better-sqlite3 implementation (Docker / Node.js target)
- `lib/db-d1.ts` -- Cloudflare D1 implementation (Cloudflare Pages target)
- `lib/db-impl.ts` -- re-exports SQLite adapter by default; CF builds override via webpack/turbopack alias
- `lib/match-data-store.ts` -- tiered match data read/write helpers: `getMatchDataWithFallback()` (Redis -> D1 -> null), `persistToMatchStore()` (D1 write + Redis 24h drain), `parseMatchCacheKey()`
- `lib/match-ttl.ts` -- pure `computeMatchTtl()` -- smart TTL tiers for pre/active/complete matches
- `lib/mcp-tools.ts` -- shared MCP tool registration (server-only, used by HTTP route + stdio server)
- `lib/types.ts` -- single source of truth for all TypeScript interfaces
- `lib/queries.ts` -- TanStack Query v5 hooks used by client components
- `components/` -- all UI; no direct API calls, all data via hooks from `lib/queries.ts`
- `app/api/events/route.ts` -- event search; defaults to `minLevel=l2plus` (hides Level I club matches)
- `app/api/og/match/[ct]/[id]/route.tsx` -- dynamic OG image generation (see `docs/og-images.md`)
- `app/api/admin/cache/health/route.ts` -- protected diagnostic endpoint (`Authorization: Bearer <CACHE_PURGE_SECRET>`); reports env var presence and runs a live write->read->delete round-trip against the cache adapter with latency
- `app/match/[ct]/[id]/layout.tsx` -- match layout with `generateMetadata()` for dynamic page titles + OG meta tags
- `app/match/[ct]/[id]/match-page-client.tsx` -- `"use client"` match page component (extracted from page.tsx to allow server-side metadata generation)
- `lib/og-data.ts` -- server-only helper that fetches match data for OG images and page metadata (1500ms timeout via `Promise.race`)
- `lib/shooter-index.ts` -- `decodeShooterId()` + `indexMatchShooters()` -- writes shooter profiles and match refs into AppDatabase (SQLite/D1)
- `lib/backfill.ts` -- pure `runBackfill()` -- scans cached matches for a shooter, dependency-injected, fully unit-tested
- `app/api/shooter/[shooterId]/route.ts` -- GET shooter dashboard (aggregates from AppDatabase + match data cache)
- `app/api/shooter/[shooterId]/backfill/route.ts` -- POST cache-scan backfill (zero GraphQL calls)
- `app/api/shooter/[shooterId]/add-match/route.ts` -- POST manual match URL (may hit GraphQL)
- `app/api/shooter/search/route.ts` -- GET name search over `shooter_profiles` (`?q=&limit=`); returns `ShooterSearchResult[]`
- `lib/achievements/` -- types, definitions, and pure `evaluateAchievements()` (see `docs/achievements.md`)
- `lib/feature-previews.ts` + `hooks/use-preview-feature.ts` -- preview feature toggle system
- `scripts/warm-cache.ts` -- CLI cache warming script; writes permanent entries to both Redis and D1/SQLite. Use `--upcoming` to populate the `matches` domain table for shooter dashboards
- `scripts/migrate-match-cache.ts` -- one-time migration: moves permanent match data from Redis to D1/SQLite (`--drain`, `--dry-run`, `--limit`)
- `mcp/` -- pnpm workspace package; stdio MCP server (`mcp/src/index.ts`) using `tsx` from root `node_modules`

## GraphQL Patterns
The SSI API uses Django content-type discrimination. Match URLs encode this:
`https://shootnscoreit.com/event/{content_type}/{id}/`

- IPSC matches: `content_type = 22`
- All queries use inline fragments: `... on IpscMatchNode { }`, `... on IpscCompetitorNode { }`
- `get_results` (official standings) is blocked during active matches -- use raw scorecard data instead
- Scorecard data is available via `event -> stages -> scorecards` path

## Testing Approach
- **Unit tests** (`tests/unit/`): pure functions only -- `parseMatchUrl`, `buildColorMap`, `computeGroupRankings`, `computeMatchTtl`
- **Component tests** (`tests/components/`): React Testing Library, focus on conditional cell rendering
- **E2E tests** (`tests/e2e/`): Playwright with `route.fulfill()` to mock `/api/*` -- no live API key needed in CI
- Extract I/O-free logic into separate files to keep unit tests fast and reliable
- CI runs: lint -> typecheck -> test -> build -> test:e2e
- **All tests must pass, all linters and type checkers must produce zero errors and zero warnings**

## Mobile-First Design (non-negotiable)

This app is used courtside during live IPSC competitions -- on a phone, outdoors, one-handed.
**Every feature must be designed mobile-first.** Desktop is an enhancement, not the baseline.

- Design for **390px width** (iPhone 14) as the primary breakpoint
- **No unintentional horizontal page overflow** at any viewport width
- All interactive elements: minimum **44x44px touch target** (enforced in `globals.css`)
- Data readable without zooming: >=14px for values, >=12px for secondary labels
- Test every UI change at mobile width before considering it done
- The comparison table is the hardest challenge -- prefer card layouts or constrained
  column widths on small screens over bare horizontal scroll

## UX & Accessibility
- Follow **WCAG 2.1 AA** throughout -- all interactive elements must be keyboard-navigable
  and have accessible names (`aria-label`, `aria-labelledby`, or visible text).
- Minimum touch target: 44x44px (`min-height: 2.75rem` applied globally in `globals.css`)
- All error states must use `role="alert"` so screen readers announce them immediately.
- Focus ring is enforced globally via `:focus-visible` in `globals.css` -- never suppress it
  with `outline-none` without providing an alternative visible focus indicator.
- **WCAG 2.1 SC 1.4.1 (Use of Color)** -- color is never the sole means of conveying information.
  Always pair with text, icon, shape, or pattern. The competitor palette in `lib/colors.ts`
  is the Okabe-Ito CVD-safe set and is paired with `SHAPE_PALETTE` (coprime cycle length, see
  `buildShapeMap()`); chart series and legend swatches must render via `CompetitorMarker` /
  `CompetitorLegendSwatch` so shape and color stay in lockstep. Status/hit-zone bars use
  pattern fills (solid/diagonal/cross-hatch) plus shape-coded pips for the same reason.
- Images and icons must have `alt` text or `aria-hidden="true"` if decorative.
- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<table>`, `<th scope>`, etc.)
  rather than `<div>` with click handlers.
- **Accordion / disclosure pattern**: always use `<hN><button aria-expanded aria-controls>...</button></hN>`
  -- never nest a heading element inside a button (invalid HTML). Expanded panels should be
  `<section role="region" aria-labelledby="button-id">` so screen readers can navigate them.
- **No duplicate landmark names**: every `role="region"` must have a unique `aria-labelledby`
  label. Two sections on the same page cannot share the same accessible name.

## Chart info popovers
Every chart section in `app/match/[ct]/[id]/match-page-client.tsx` has a `?` (`HelpCircle`) icon button
that opens a `<Popover>` explaining the chart. **When adding a new chart section, always add
a matching info popover.** When modifying what a chart shows, update its popover text to match.
The popover should include: what the axes/axes represent, how to read the visual, and 1-2
actionable interpretation tips. Keep language concise -- max ~4 short paragraphs.

The same pattern applies to sections on the shooter dashboard. The Achievements section
has a section-level info popover explaining the tier ladder concept, and each achievement
card is tappable to reveal its full unlock ladder with progress indicators.

## Design System & Tailwind v4
- Use **Tailwind v4** utility classes everywhere -- no inline styles.
- All colors, spacing, and radii come from **CSS custom property design tokens** defined
  in `app/globals.css`. Prefer semantic tokens (`bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`) over raw palette classes (`bg-gray-100`).
- The color palette uses **OKLCH** for perceptual uniformity -- extend tokens in `globals.css`
  under `@theme inline` when new semantic colors are needed. Do not hard-code hex/rgb.
- Dark mode is supported via the `.dark` class -- all tokens have dark-mode values.
- shadcn/ui components in `components/ui/` are the primary component library.
  Do not modify them directly; use `pnpm dlx shadcn@latest add` to add/update.
- Competitor colors (`lib/colors.ts`) use explicit hex values chosen for WCAG contrast
  against both light and dark backgrounds -- update with care.

## Code Conventions
- All interfaces in `lib/types.ts` -- do not define inline types in components
- `lib/graphql.ts` is server-only -- never import it from client components
- Competitor colors are deterministic by index in `selectedIds` array (see `lib/colors.ts`)
- `group_leader_points` on `StageComparison` is reserved for the future benchmark overlay feature -- do not remove
- shadcn components live in `components/ui/` -- do not modify generated files directly

## Cache Schema Versioning

`CACHE_SCHEMA_VERSION` in `lib/constants.ts` is embedded in every cache entry as `v` -- in
both Redis and the D1/SQLite `match_data_cache` table (`schema_version` column).
Whenever the **shape** of a cached GraphQL response changes (new fields, removed fields,
renamed fields), bump `CACHE_SCHEMA_VERSION` by 1 and add a one-line history comment.

Entries missing `v` or carrying an older version are treated as cache misses and re-fetched
automatically -- no manual `CACHE_PURGE_SECRET` flush is needed. The cache self-heals within
one TTL cycle. This applies to both Redis entries and D1/SQLite entries read via
`getMatchDataWithFallback()`.

**Rule of thumb:** bump whenever you add or remove a field on `MatchResponse`, `CompareResponse`,
or any other type that is serialised into the **match cache** (Redis/D1) via `cachedExecuteQuery`.
This does **not** apply to AppDatabase schema changes -- those are managed independently by
the SQLite/D1 adapters via `CREATE TABLE IF NOT EXISTS`.

## Delta-merge contract (CRITICAL) -> `docs/delta-merge.md`

`refreshCachedMatchQuery` mirrors SSI's data structure and applies upstream changes
incrementally via the match-level probe (#361) and scorecard delta merge (#362). SSI schema
drift can silently corrupt cached snapshots, so changes to scorecard fields must touch
**all** of: `SCORECARD_NODE_FIELDS`, `RawScCard`, `ScorecardDeltaEntry`, `deltaToCacheCard()`,
`parseRawScorecards()`, `CACHE_SCHEMA_VERSION`, and `scripts/ssi-schema-snapshot.json` -- in
the same PR. Run `pnpm check:ssi-schema` and `pnpm validate:ssi-queries` before committing.
Recovery lever: `POST /api/admin/cache/force-refresh?ct=&id=`. Full details, drift triage,
and recovery commands live in `docs/delta-merge.md`.

## Telemetry -> `docs/telemetry.md`

Structured-event logging in `lib/telemetry.ts` with per-domain wrappers (`cache-`, `upstream-`,
`error-`, `usage-`, `mcp-telemetry.ts`). MCP traffic is auto-tagged `via:"mcp"` via
AsyncLocalStorage. **Privacy commitments:** never log IP/UA/shooter IDs/specific competitor IDs
or raw search text -- only bucketed counts and lengths. Sinks: `console.info` always, R2 NDJSON
on Cloudflare. New REST routes that the MCP toolset reaches must call `maybeTagAsMcp(req)` at
the top of the handler. See `docs/telemetry.md` for adding domains/sinks, R2 setup, and how to
read R2 telemetry via `wrangler login` + REST API.

## Shooter Index & Match Backfill -> `docs/shooter-index.md`

Persistent **AppDatabase** (SQLite on Docker, D1 on Cloudflare) tracks which matches each
shooter has appeared in. Tables: `shooter_profiles`, `shooter_matches` (capped 200/shooter),
`match_popularity`, `shooter_achievements`, `match_data_cache`, `matches`. Tiered read path:
Redis -> D1/SQLite `match_data_cache` -> GraphQL. Schema is dual-defined in
`lib/db-migrations.ts` (SQLite runtime) and `migrations/*.sql` (D1) -- keep them in sync,
idempotent DDL only, expand-contract pattern. See `docs/shooter-index.md` for the full
population matrix, schema details, and one-time migration steps.

## Feature Previews

Beta features are toggled per-user via localStorage under key `ssi-preview-features`.
Activate/deactivate at runtime via URL params:
- `?preview=new-id` -- enable a feature
- `?preview=-new-id` -- disable
- `?preview=a,b` -- comma-separated for multiple

The `usePreviewFeature("new-id")` hook (from `hooks/use-preview-feature.ts`) provides
SSR-safe access for client components. Preview-gated sections render a "Preview" badge
next to their heading. When a feature graduates to stable, remove the preview check.

**Adding a new preview feature:**
1. Add the string ID to `PREVIEW_FEATURES` in `lib/feature-previews.ts`
2. Use `usePreviewFeature("new-id")` in the relevant component
3. Share `?preview=new-id` URLs with testers

## Achievement System -> `docs/achievements.md`

Tiered achievements on the shooter dashboard, persisted in `shooter_achievements` so unlocks
survive the 200-match prune window. Pure `evaluateAchievements()` runs on dashboard cache miss
and persists new tiers fire-and-forget. Adding an achievement: append one entry to
`ACHIEVEMENT_ENTRIES` in `lib/achievements/definitions.ts` -- no schema changes needed. See
`docs/achievements.md` for the full category list and key files.

## What's New dialog -> `docs/whats-new.md`

Auto-shows once per release; also reachable from the footer. To announce a release, prepend a
`Release` entry (with ISO `id`, `date`, `sections`, and `screenshotScenes`) to `RELEASES` in
`lib/releases.ts`. Add an entry whenever a user-visible feature ships. See `docs/whats-new.md`
for the full entry shape, screenshot scene catalogue, and rules for adding new scenes.

## Environment Variables -> `docs/env-vars.md`

Full table of every env var, where it's read, which deploy target uses it, and notes/defaults.
Headline gotchas:
- `SSI_API_KEY`, `CACHE_PURGE_SECRET`, all `*_TELEMETRY*`, `MATCH_*`, `SCORECARDS_*`,
  `MCP_SECRET`, `AI_*` -- **never** prefix with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_APP_URL` are the only intentionally public ones.
- Docker target needs `REDIS_URL` and optionally `SHOOTER_DB_PATH`. Cloudflare target needs
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` plus the `APP_DB` and `AI` bindings.

## OG Images -> `docs/og-images.md`

`app/api/og/match/[ct]/[id]/route.tsx` renders three Satori variants (overview, single
competitor, multi-competitor). `lib/og-data.ts` uses the cached GraphQL path with a 1500ms
timeout via `Promise.race` so slow upstreams never block `generateMetadata()`. Cache-Control
varies by completion state. See `docs/og-images.md` for local testing commands.

## MCP Server -> `docs/mcp-server.md` (developer) and `docs/mcp.md` (user)

Seven tools shared via `lib/mcp-tools.ts` (`search_events`, `get_match`, `compare_competitors`,
`get_stage_times`, `get_popular_matches`, `get_shooter_dashboard`, `find_shooter`) between two transports:
- HTTP stateless JSON-RPC at `app/api/mcp/route.ts`
- stdio at `mcp/src/index.ts` (Claude Desktop / Claude Code via `.mcp.json`)

Smithery publishes us as an external server; updating the registry's configSchema requires
running the `Publish to Smithery Registry` GitHub workflow (the UI has no field for it on
external servers). See `docs/mcp-server.md` for full developer notes.

## Package Manager
This project uses **pnpm@10.30.3**. Do not use npm or yarn. Use `pnpm add` / `pnpm add -D`.
When adding new packages, always specify the exact latest stable version (check with `npm show <pkg> version`).

### Intentionally pinned majors -- do not blindly upgrade these

| Package | Pinned at | Reason |
|---|---|---|
| `zod` | `3.x` | Zod 4 has a breaking API (new parse behaviour, removed methods). Requires a dedicated migration pass across all usages in `lib/` and `app/api/`. |
| `eslint` | `^9` | ESLint 10 is brand-new; ecosystem plugins (including `eslint-config-next`) may not yet support it. Revisit once `eslint-config-next` explicitly lists `eslint@10` as a peer. |

## Deployment targets -> `docs/deployment.md`

Two targets selected by `DEPLOY_TARGET`:
- **Docker / Docker Compose** (default): `pnpm docker:build` + `pnpm docker:up`. Uses ioredis +
  better-sqlite3. Two named volumes (`redis_data`, `shooter_data`) persist state.
- **Cloudflare Pages**: `pnpm cf:build` + `pnpm cf:deploy`. `DEPLOY_TARGET=cloudflare`
  swaps `lib/cache-impl` -> `lib/cache-edge` (Upstash HTTP) and `lib/db-impl` -> `lib/db-d1`.
  Bindings: `AI` (Workers AI), `APP_DB` (D1).

See `docs/deployment.md` for the full setup steps (one-time D1 setup, secrets, bare-server
deploys without Docker Compose).
