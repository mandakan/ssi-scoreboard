# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Commands
```bash
pnpm dev              # start Next.js dev server (port 3000)
pnpm build            # production build
pnpm -w run lint      # ESLint (eslint .) — zero warnings required
pnpm -w run typecheck # tsc --noEmit — zero errors required
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
the ShootNScoreIt GraphQL API — the `SSI_API_KEY` lives in `.env.local` and must never
be referenced from any file with `"use client"` or any file under `lib/` that is imported
by client components.

```
Browser → Next.js Route Handlers → shootnscoreit.com/graphql/
```

Key directories:
- `app/api/match/[ct]/[id]/route.ts` — proxies match overview query
- `app/api/compare/route.ts` — fans out competitor scorecard queries, calls logic.ts
- `app/api/compare/logic.ts` — **pure function** `computeGroupRankings()`, no I/O, fully unit-tested
- `app/api/mcp/route.ts` — MCP HTTP endpoint (JSON-RPC, single-shot transport); optional `MCP_SECRET` bearer auth
- `lib/graphql.ts` — GQL query strings + `executeQuery()`, server-only (no NEXT_PUBLIC_ prefix)
- `lib/cache.ts` — `CacheAdapter` interface (get/set/persist/del/expire/scanRecentKeys)
- `lib/cache-node.ts` — ioredis implementation (Docker / Node.js target)
- `lib/cache-edge.ts` — @upstash/redis HTTP implementation (Cloudflare Pages target)
- `lib/cache-impl.ts` — re-exports node adapter by default; CF builds override via webpack alias
- `lib/match-ttl.ts` — pure `computeMatchTtl()` — smart TTL tiers for pre/active/complete matches
- `lib/mcp-tools.ts` — shared MCP tool registration (server-only, used by HTTP route + stdio server)
- `lib/types.ts` — single source of truth for all TypeScript interfaces
- `lib/queries.ts` — TanStack Query v5 hooks used by client components
- `components/` — all UI; no direct API calls, all data via hooks from `lib/queries.ts`
- `app/api/events/route.ts` — event search; defaults to `minLevel=l2plus` (hides Level I club matches); users can switch to "All", "L3+", or "L4+" in the filter panel
- `app/api/og/match/[ct]/[id]/route.tsx` — dynamic OG image generation (match overview, single competitor, multi-competitor variants); uses `next/og` (Satori)
- `app/api/admin/cache/health/route.ts` — protected diagnostic endpoint (`Authorization: Bearer <CACHE_PURGE_SECRET>`); reports env var presence and runs a live write→read→delete round-trip against the cache adapter with latency
- `app/match/[ct]/[id]/layout.tsx` — match layout with `generateMetadata()` for dynamic page titles + OG meta tags
- `app/match/[ct]/[id]/match-page-client.tsx` — `"use client"` match page component (extracted from page.tsx to allow server-side metadata generation)
- `lib/og-data.ts` — server-only helper that fetches match data for OG images and page metadata (1500ms timeout via `Promise.race`)
- `mcp/` — pnpm workspace package; stdio MCP server (`mcp/src/index.ts`) using `tsx` from root `node_modules`

## GraphQL Patterns
The SSI API uses Django content-type discrimination. Match URLs encode this:
`https://shootnscoreit.com/event/{content_type}/{id}/`

- IPSC matches: `content_type = 22`
- All queries use inline fragments: `... on IpscMatchNode { }`, `... on IpscCompetitorNode { }`
- `get_results` (official standings) is blocked during active matches — use raw scorecard data instead
- Scorecard data is available via `event -> stages -> scorecards` path

## Testing Approach
- **Unit tests** (`tests/unit/`): pure functions only — `parseMatchUrl`, `buildColorMap`, `computeGroupRankings`, `computeMatchTtl`
- **Component tests** (`tests/components/`): React Testing Library, focus on conditional cell rendering
- **E2E tests** (`tests/e2e/`): Playwright with `route.fulfill()` to mock `/api/*` — no live API key needed in CI
- Extract I/O-free logic into separate files to keep unit tests fast and reliable
- CI runs: lint → typecheck → test → build → test:e2e
- **All tests must pass, all linters and type checkers must produce zero errors and zero warnings**

## Mobile-First Design (non-negotiable)

This app is used courtside during live IPSC competitions — on a phone, outdoors, one-handed.
**Every feature must be designed mobile-first.** Desktop is an enhancement, not the baseline.

- Design for **390px width** (iPhone 14) as the primary breakpoint
- **No unintentional horizontal page overflow** at any viewport width
- All interactive elements: minimum **44×44px touch target** (enforced in `globals.css`)
- Data readable without zooming: ≥14px for values, ≥12px for secondary labels
- Test every UI change at mobile width before considering it done
- The comparison table is the hardest challenge — prefer card layouts or constrained
  column widths on small screens over bare horizontal scroll

## UX & Accessibility
- Follow **WCAG 2.1 AA** throughout — all interactive elements must be keyboard-navigable
  and have accessible names (`aria-label`, `aria-labelledby`, or visible text).
- Minimum touch target: 44×44px (`min-height: 2.75rem` applied globally in `globals.css`)
- All error states must use `role="alert"` so screen readers announce them immediately.
- Focus ring is enforced globally via `:focus-visible` in `globals.css` — never suppress it
  with `outline-none` without providing an alternative visible focus indicator.
- Color is never the sole means of conveying information — always pair with text, icons, or shape.
- Images and icons must have `alt` text or `aria-hidden="true"` if decorative.
- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<table>`, `<th scope>`, etc.)
  rather than `<div>` with click handlers.
- **Accordion / disclosure pattern**: always use `<hN><button aria-expanded aria-controls>…</button></hN>`
  — never nest a heading element inside a button (invalid HTML). Expanded panels should be
  `<section role="region" aria-labelledby="button-id">` so screen readers can navigate them.
- **No duplicate landmark names**: every `role="region"` must have a unique `aria-labelledby`
  label. Two sections on the same page cannot share the same accessible name.

## What's New dialog

A "What's New" dialog auto-shows once per release whenever a user opens the app after a new
entry has been added. It is also accessible at any time via the "What's new" link in the footer.

**To announce a new release:**
1. Open `lib/releases.ts`.
2. **Prepend** a new `Release` object to the `RELEASES` array (newest entry must always be first).
3. Set `id` to an ISO date string (e.g. `"2026-03-15"`) — this is the key stored in
   `localStorage("whats-new-seen-id")`. The dialog shows whenever this `id` differs from
   what the user's browser last saw.
4. Fill in `date` (human-readable), optional `title`, and one or more `sections`
   (`heading` + `items` string array).

```ts
// lib/releases.ts — example new entry
{
  id: "2026-03-15",
  date: "March 15, 2026",
  title: "Squad View & Performance Trends",
  sections: [
    {
      heading: "New",
      items: [
        "Squad view: filter the comparison table to a single squad.",
        "Performance trend sparklines on the stage list.",
      ],
    },
    {
      heading: "Improved",
      items: ["Faster initial load on slow connections."],
    },
  ],
},
```

**Key files:**
- `lib/releases.ts` — the only file you edit to publish a new What's New
- `lib/types.ts` — `Release` / `ReleaseSection` interfaces
- `components/whats-new-provider.tsx` — context, auto-show logic, dialog render
- `components/footer.tsx` — "What's new" trigger link

**Rule of thumb:** add an entry whenever a user-visible feature ships. Skip patch/fix-only
deploys unless the fix is prominent enough that users should know about it.

**`screenshotScenes`:** new releases must include a `screenshotScenes` array. Point it at
the scenes from `scripts/screenshot-match.ts` that best showcase the new feature.
Each scene is captured at both mobile (390×844) and desktop (1280×900).

Current catalogue: `comparison-table`, `degradation-chart`, `hf-level-bars`,
`archetype-chart`, `style-fingerprint`, `shooter-dashboard`, `whats-new-dialog`. Omit the field to capture all.

**When to add a new scene:** if a new chart or UI section isn't well-represented by any
existing scene, add one to `scripts/screenshot-match.ts` (follow the existing `Scene`
pattern: `name`, `description`, `suppressWhatsNew`, `setup`). If the new section is inside
the "Coaching analysis" accordion, call `openCoachingSection(page)` before scrolling.
Update the catalogue list above and in `docs/release-post.md` whenever scenes are added.

## Chart info popovers
Every chart section in `app/match/[ct]/[id]/match-page-client.tsx` has a `?` (`HelpCircle`) icon button
that opens a `<Popover>` explaining the chart. **When adding a new chart section, always add
a matching info popover.** When modifying what a chart shows, update its popover text to match.
The popover should include: what the axes/axes represent, how to read the visual, and 1–2
actionable interpretation tips. Keep language concise — max ~4 short paragraphs.

## Design System & Tailwind v4
- Use **Tailwind v4** utility classes everywhere — no inline styles.
- All colors, spacing, and radii come from **CSS custom property design tokens** defined
  in `app/globals.css`. Prefer semantic tokens (`bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`) over raw palette classes (`bg-gray-100`).
- The color palette uses **OKLCH** for perceptual uniformity — extend tokens in `globals.css`
  under `@theme inline` when new semantic colors are needed. Do not hard-code hex/rgb.
- Dark mode is supported via the `.dark` class — all tokens have dark-mode values.
- shadcn/ui components in `components/ui/` are the primary component library.
  Do not modify them directly; use `pnpm dlx shadcn@latest add` to add/update.
- Competitor colors (`lib/colors.ts`) use explicit hex values chosen for WCAG contrast
  against both light and dark backgrounds — update with care.

## Code Conventions
- All interfaces in `lib/types.ts` — do not define inline types in components
- `lib/graphql.ts` is server-only — never import it from client components
- Competitor colors are deterministic by index in `selectedIds` array (see `lib/colors.ts`)
- `group_leader_points` on `StageComparison` is reserved for the future benchmark overlay feature — do not remove
- shadcn components live in `components/ui/` — do not modify generated files directly

## Cache Schema Versioning
`CACHE_SCHEMA_VERSION` in `lib/constants.ts` is embedded in every Redis cache entry as `v`.
Whenever the **shape** of a cached GraphQL response changes (new fields, removed fields,
renamed fields), bump `CACHE_SCHEMA_VERSION` by 1 and add a one-line history comment.

Entries missing `v` or carrying an older version are treated as cache misses and re-fetched
automatically — no manual `CACHE_PURGE_SECRET` flush is needed. The new entry is written
with the current version on the first request, so the cache self-heals within one TTL cycle.

**Rule of thumb:** bump whenever you add or remove a field on `MatchResponse`, `CompareResponse`,
or any other type that is serialised into Redis via `cachedExecuteQuery`.

## Environment Variables
| Variable | Where used | Target | Notes |
|---|---|---|---|
| `SSI_API_KEY` | `lib/graphql.ts` (server-only) | Both | Never use `NEXT_PUBLIC_` prefix |
| `CACHE_PURGE_SECRET` | `app/api/admin/cache/purge/route.ts`, `app/api/admin/cache/health/route.ts` | Both | Any strong random string; never `NEXT_PUBLIC_` |
| `MIN_CACHE_TTL_SECONDS` | `lib/match-ttl.ts` (server-only) | Both | Minimum TTL floor for all non-permanent cache entries. Default `300` (5 min). Set to `0` to disable. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_BUILD_ID` | `components/update-banner.tsx`, `app/api/version/route.ts` | Both | Git SHA baked into the client bundle at Docker build time; powers new-version detection. Auto-injected by `pnpm docker:build`. Unset in `pnpm dev` — version check is skipped. |
| `REDIS_URL` | `lib/cache-node.ts` | Docker only | `redis://localhost:6379` locally, `rediss://...` for managed Redis. Not needed for CF builds. |
| `UPSTASH_REDIS_REST_URL` | `lib/cache-edge.ts` | Cloudflare only | REST URL from Upstash console. Set via `wrangler secret put` in production. |
| `UPSTASH_REDIS_REST_TOKEN` | `lib/cache-edge.ts` | Cloudflare only | REST token from Upstash console. Set via `wrangler secret put` in production. |
| `MCP_SECRET` | `app/api/mcp/route.ts` | Both | Optional. If set, `POST /api/mcp` requires `Authorization: Bearer <MCP_SECRET>`. Omit for public access. |
| `NEXT_PUBLIC_APP_URL` | `app/api/mcp/route.ts`, `app/match/[ct]/[id]/layout.tsx` | Both | Base URL used by MCP tools and OG image meta tags. Defaults to `http://localhost:PORT`. Required for Cloudflare Pages (set to the external URL, e.g. `https://scoreboard.urdr.dev`). |
| `AI_PROVIDER` | `lib/ai-provider.ts` (server-only) | Both | `"cloudflare"` or `"openai"`. Omit to disable AI coaching tips. Never `NEXT_PUBLIC_`. |
| `AI_MODEL` | `lib/ai-provider.ts` (server-only) | Both | Model identifier, e.g. `"gpt-4o-mini"` or `"@cf/meta/llama-3.1-8b-instruct"`. Never `NEXT_PUBLIC_`. |
| `AI_API_KEY` | `lib/ai-provider.ts` (server-only) | Both | API key/token for the AI provider. **Optional for `cloudflare` provider** — omit to use the Workers AI binding (`env.AI`) instead of the REST API. Never `NEXT_PUBLIC_`. |
| `AI_API_URL` | `lib/ai-provider.ts` (server-only) | Both | Base URL. Required for Cloudflare Workers AI. Defaults to `https://api.openai.com/v1` for `openai`. |
| `SMITHERY_API_KEY` | `.github/workflows/smithery-publish.yml` | CI only | Smithery registry API key. Store as a GitHub `production` environment secret. Obtain from https://smithery.ai/account/api-keys. Never `NEXT_PUBLIC_`. |

## OG Images

Dynamic Open Graph images are generated on-the-fly for match pages using `next/og` (Satori).
The OG image endpoint at `app/api/og/match/[ct]/[id]/route.tsx` renders three variants:

- **Match overview** — match name, venue/date/level, stat badges (stages, competitors, % scored)
- **Single competitor** — competitor name, division/club, match context
- **Multi-competitor** — "Comparing N competitors" with colored bullets (uses PALETTE from `lib/colors.ts`)

Page metadata in `app/match/[ct]/[id]/layout.tsx` sets `<meta property="og:image">` pointing at
the OG endpoint. The OG URL intentionally omits `?competitors=` to avoid `searchParams` dependency
(which would block client-side soft navigation). The endpoint accepts an optional `?competitors=`
param for direct use.

`lib/og-data.ts` fetches match data using the same cached GraphQL path as the match API route
(usually a Redis cache hit). A 1500ms timeout via `Promise.race` prevents slow upstreams from
blocking `generateMetadata()` during client-side `router.replace()` soft navigations.

Cache-Control headers are set based on match completion: active matches get short TTLs (1min/5min),
completed matches get long TTLs (1day/7days).

**Local testing:**
```bash
pnpm dev
# Open directly in browser — returns a PNG:
open http://localhost:3000/api/og/match/22/{match_id}
# With competitors:
open http://localhost:3000/api/og/match/22/{match_id}?competitors=123,456
# Inspect the meta tags in page source:
curl -s http://localhost:3000/match/22/{match_id} | grep 'og:image'
```

## MCP Server

The app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server with four tools:
`search_events`, `get_match`, `compare_competitors`, `get_popular_matches`.

Two transport modes share the same tool logic via `lib/mcp-tools.ts`:
- **HTTP** (`app/api/mcp/route.ts`) — stateless JSON-RPC, single-shot transport; used by the Smithery
  external deployment and any MCP-over-HTTP client.
- **stdio** (`mcp/src/index.ts`) — spawned by Claude Desktop / Claude Code via `.mcp.json`.

The stdio server's `configSchema` (a Zod schema exported from `mcp/src/index.ts`) and `createServer`
default export are used by Smithery's hosted TypeScript runtime. The HTTP server always uses
`NEXT_PUBLIC_APP_URL` (or `http://localhost:PORT`) as its `baseUrl` — it does not read session config.

User-facing setup guide: `docs/mcp.md`.

### Smithery registry

The server is published on [smithery.ai](https://smithery.ai) as an **external** server
pointing at `https://scoreboard.urdr.dev/api/mcp` (qualified name: `mandakan/ssi-scoreboard`).

**Metadata set via the Smithery UI (registry listing page):**
- Homepage → `https://scoreboard.urdr.dev`
- Icon → `https://scoreboard.urdr.dev/icons/icon-512.png`

**Tool annotations** (`readOnlyHint: true`, `openWorldHint: true`) are declared inline in
`lib/mcp-tools.ts` as the 4th argument to each `server.tool()` call.

**Publishing / updating the registry entry** — trigger the `Publish to Smithery Registry`
workflow manually from the GitHub Actions tab (workflow_dispatch). This pushes the latest
configSchema (`mcp/smithery-config-schema.json`) to the external deployment. The Smithery UI
has no field for configSchema on external servers — the workflow is the only way to update it.

Prerequisite: add `SMITHERY_API_KEY` as a secret in the GitHub repo's `production` environment
(Settings → Environments → production → Add secret). Obtain the key from
https://smithery.ai/account/api-keys.

The `configSchema` block in `smithery.yaml` mirrors `mcp/smithery-config-schema.json` and
covers the hosted TypeScript runtime path. Keep both in sync when changing the schema.

## Package Manager
This project uses **pnpm@10.30.3**. Do not use npm or yarn. Use `pnpm add` / `pnpm add -D`.
When adding new packages, always specify the exact latest stable version (check with `npm show <pkg> version`).

### Intentionally pinned majors — do not blindly upgrade these

| Package | Pinned at | Reason |
|---|---|---|
| `zod` | `3.x` | Zod 4 has a breaking API (new parse behaviour, removed methods). Requires a dedicated migration pass across all usages in `lib/` and `app/api/`. |
| `eslint` | `^9` | ESLint 10 is brand-new; ecosystem plugins (including `eslint-config-next`) may not yet support it. Revisit once `eslint-config-next` explicitly lists `eslint@10` as a peer. |

## Deployment targets

The app supports two build targets selected by the `DEPLOY_TARGET` env var at build time.

### Docker / Docker Compose (default)
```bash
cp .env.local.example .env.local   # fill in SSI_API_KEY, CACHE_PURGE_SECRET
pnpm docker:build                  # builds image (passes --env-file .env.local)
pnpm docker:up                     # starts redis + app on port 3000
```
`docker:up` passes `--env-file .env.local` so `${SSI_API_KEY}`, `${CACHE_PURGE_SECRET}` are
available at runtime. `REDIS_URL` is set automatically via the compose service name
(`redis://redis:6379`) — no manual entry needed.
The Dockerfile uses multi-stage builds (deps → builder → runner) with a non-root user.
`output: "standalone"` in `next.config.ts` is set automatically when `DEPLOY_TARGET` is unset.
The `redis_data` volume persists the cache across container restarts.

#### Deploying without Docker Compose (bare server, Kubernetes, Fly.io)
Run a Redis instance (managed or self-hosted) and set `REDIS_URL` to its connection string.
Use `rediss://` (TLS) for cloud-managed providers such as Upstash or Redis Cloud.
The app connects with `lazyConnect: true`, so a missing Redis at startup is non-fatal —
requests will fall back to direct GraphQL fetches until Redis is reachable.

### Cloudflare Pages
```bash
pnpm cf:build    # DEPLOY_TARGET=cloudflare @opennextjs/cloudflare build (runs next build internally)
pnpm cf:deploy   # cf:build + wrangler pages deploy
```
`DEPLOY_TARGET=cloudflare` triggers a webpack/Turbopack alias that swaps `lib/cache-impl.ts`
for the Upstash HTTP adapter (`lib/cache-edge.ts`) so `ioredis` is never bundled into the
Worker. Route handlers use the default Node.js runtime — `@opennextjs/cloudflare` handles
the Workers bundling without requiring `export const runtime = "edge"` on each route.
The `popular-matches` endpoint returns `[]` on CF (OBJECT IDLETIME not available via HTTP).

**Cache adapter:** the CF build uses `@upstash/redis` (HTTP-based) instead of ioredis.
`automaticDeserialization: false` is set on the Upstash client so values are returned as raw
strings, consistent with the ioredis adapter — callers always do their own `JSON.parse`.

Set secrets in production via `wrangler secret put` or the Cloudflare Pages dashboard:
```bash
wrangler secret put SSI_API_KEY
wrangler secret put CACHE_PURGE_SECRET
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```
