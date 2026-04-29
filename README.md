<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/logo-dark.svg">
  <img src="public/logo-light.svg" alt="SSI Scoreboard" height="60">
</picture>

# SSI Scoreboard

[![CI](https://github.com/mandakan/ssi-scoreboard/actions/workflows/ci.yml/badge.svg)](https://github.com/mandakan/ssi-scoreboard/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/Live-scoreboard.urdr.dev-4f46e5?logo=vercel&logoColor=white)](https://scoreboard.urdr.dev)
[![smithery badge](https://smithery.ai/badge/mandakan/ssi-scoreboard)](https://smithery.ai/servers/mandakan/ssi-scoreboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/thias)

Live stage-by-stage comparison tool for IPSC competitions on [shootnscoreit.com](https://shootnscoreit.com).

The official site only lets you view one competitor at a time. This app lets you select
any group of competitors and compare their results across every stage side-by-side --
including during an active match before official results are published.

**Live instance:** [scoreboard.urdr.dev](https://scoreboard.urdr.dev) -- not affiliated with or endorsed by ShootNScoreIt.

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10.30.3 --activate`)
- A ShootNScoreIt API key (account settings on shootnscoreit.com)

## Local Setup

```bash
pnpm install
cp .env.local.example .env.local   # then fill in SSI_API_KEY
pnpm dev                            # http://localhost:3000
```

## Deployment

The app supports two production targets, selected at build time via `DEPLOY_TARGET`. Both
require a Redis instance for hot caching, and a relational store (SQLite or D1) for
persistent shooter / match metadata that survives Redis flushes.

### Docker / Docker Compose

```bash
cp .env.local.example .env.local   # fill in SSI_API_KEY, CACHE_PURGE_SECRET
pnpm docker:build                   # builds image
pnpm docker:up                      # starts redis + app on port 3000
```

`REDIS_URL` is set automatically via the compose service name. Two named volumes persist
state across container restarts:
- `redis_data` -- Redis hot cache
- `shooter_data` -> `/app/data` -- SQLite store (shooter profiles, match indices, achievements, historical match cache)

**Without Docker Compose** (bare server, Kubernetes, Fly.io): run a Redis instance and
set `REDIS_URL` to its connection string (`rediss://` for TLS). Mount a writable volume
at `./data/` (or set `SHOOTER_DB_PATH`) so the SQLite database persists. The app uses
`lazyConnect: true`, so a missing Redis at startup is non-fatal -- requests fall back to
direct GraphQL fetches.

### Cloudflare Pages

The Cloudflare build swaps in HTTP-based adapters at build time:
- `@upstash/redis` instead of `ioredis` (Workers cannot open TCP)
- Cloudflare D1 instead of `better-sqlite3` (Workers have no persistent disk)

You will need an [Upstash](https://upstash.com) Redis database and a D1 database.

```bash
pnpm cf:build    # DEPLOY_TARGET=cloudflare + @opennextjs/cloudflare build
pnpm cf:deploy   # build + wrangler deploy
```

Full step-by-step walkthrough -- wrangler login, secrets, custom subdomain, verification,
troubleshooting -- in **[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)**.

> **Note on serverless platforms without persistent disk** (Vercel, Netlify default):
> the app's SQLite AppDatabase needs writable disk for shooter/match metadata. These
> platforms only work if you switch the persistence layer to D1 or a managed SQL store --
> they are not currently supported targets.

## Environment Variables

The most common ones an operator needs:

| Variable | Target | Description |
|---|---|---|
| `SSI_API_KEY` | Both | ShootNScoreIt API key -- server-side only, never exposed to browser |
| `CACHE_PURGE_SECRET` | Both | Secret for the admin cache-purge endpoint -- any strong random string |
| `NEXT_PUBLIC_BUILD_ID` | Both | Git SHA baked into the bundle for version detection (auto-injected by `pnpm docker:build`) |
| `REDIS_URL` | Docker | Redis connection string (`redis://localhost:6379`, or `rediss://...` for TLS) |
| `SHOOTER_DB_PATH` | Docker | Optional. Path to SQLite database file. Defaults to `./data/shooter-index.db` |
| `UPSTASH_REDIS_REST_URL` | Cloudflare | REST URL from the Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Cloudflare | REST token from the Upstash console |
| `MCP_SECRET` | Both | Optional. If set, `POST /api/mcp` requires `Authorization: Bearer <MCP_SECRET>` |
| `NEXT_PUBLIC_APP_URL` | Both | Base URL for MCP tool internal API calls. Required on Cloudflare Pages |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_API_URL` | Both | AI coaching tips. Set to `"openai"` or `"cloudflare"`; omit `AI_PROVIDER` to disable |

**Full reference** -- including TTL tunables, telemetry sampling, probe kill switches, and
all internal flags -- in **[docs/env-vars.md](docs/env-vars.md)**.

## Usage

1. Browse competitions month by month using the month navigator on the landing page,
   or paste a match URL (`https://shootnscoreit.com/event/22/26547/`) to jump straight
   to a match. The collapsible **Filters** panel narrows results by discipline, country,
   and level.
2. Select competitors individually by name, number, or club -- or tap **Add squad** to
   load an entire IPSC squad at once (up to 12 competitors total).
3. Multiple analysis views update immediately (stage table, hit-factor and HF% charts,
   speed/accuracy scatter, balance radar, coaching panels, style fingerprint, AI tip).
4. Use the **Share** button to copy the link with selections encoded -- recipients open
   the same match with the same competitors pre-selected.

## Features

**Comparison & rankings**
- Side-by-side stage table with hit factor, time, hit zones, rank, percentile, shooting order, stage difficulty, run classification
- Group / Division / Overall ranking contexts
- Delta heatmap view (each cell relative to the group leader)
- Incomplete scorecard flag (IPSC rule 9.7.6.2)
- DQ banner and clean-match indicator

**Charts**
- Hit-factor bar chart with optional benchmark overlay
- HF% vs stage-winner line chart
- Speed-vs-accuracy scatter with iso-HF reference lines
- Stage-balance polar radar
- Style fingerprint (alpha ratio vs PPS) with archetype labels
- Style radar (composure, consistency, multi-axis profile)
- Info popovers on every chart explaining axes and reading tips

**Coaching analysis**
- Consistency score (CV of HF% across fired stages), efficiency (points per shot)
- Penalty rate, match-percentage impact, points left on the table
- "One stage away" what-if analysis
- AI coaching tips for completed matches (sparkle icon; requires AI provider configuration)

**Cross-competition (shooter dashboard)**
- Per-shooter career view with match history, aggregate stats
- Tiered achievements that survive the 200-match prune window
- Manual match URL submission, dashboard backfill from cached data

**Search & navigation**
- Month-by-month browser; typing a query switches to full-history search mode
- Filters: firearms, country (ISO 3166-1 alpha-3, defaults to SWE), level (L2+, L3+, L4+, all)
- Recent matches list (localStorage)
- Shareable URLs encode the full competitor selection

**Platform**
- Server-side cache with smart TTL tiers (future / pre-match / active / complete)
- Persistent SQLite/D1 store for shooter profiles, match indices, achievements, historical match cache
- Dynamic Open Graph images per match (Satori / `next/og`)
- MCP server (HTTP + stdio transports) -- 7 tools for AI assistant integration
- New-version banner; PWA installable; mobile-first (390px); WCAG 2.1 AA; dark mode

## Development Commands

```bash
pnpm dev          # start dev server on port 3000
pnpm build        # production build
pnpm lint         # ESLint -- zero warnings required
pnpm typecheck    # TypeScript type check -- zero errors required
pnpm test         # Vitest unit + component tests
pnpm test:watch   # Vitest in watch mode
pnpm test:e2e     # Playwright E2E tests (mocked API, no live key needed)
pnpm test:e2e:ui  # Playwright with interactive UI
```

**Quality bar:** `pnpm lint`, `pnpm typecheck`, and `pnpm test` must all pass with **zero
errors and zero warnings** before merging. CI enforces this.

### Intentionally pinned major versions

Held back from latest -- don't upgrade without a migration plan:

| Package | Pinned at | Why |
|---|---|---|
| `zod` | 3.x | Zod 4 has breaking API changes. Needs a dedicated migration across `lib/` and `app/api/`. |
| `eslint` | ^9 | ESLint 10 is brand-new; wait until `eslint-config-next` officially supports it as a peer dep. |

## MCP Server

SSI Scoreboard exposes an [MCP](https://modelcontextprotocol.io) server so Claude and other
AI assistants can query competition data directly. Seven tools: `search_events`, `get_match`,
`compare_competitors`, `get_stage_times`, `get_popular_matches`, `get_shooter_dashboard`,
`find_shooter`.

**HTTP transport** (public, no local setup needed):
```
POST https://scoreboard.urdr.dev/api/mcp
```

**stdio transport** (local subprocess) -- `.mcp.json` at repo root pre-registers two stdio
servers:
- `ssi-scoreboard` -- calls the live production instance (no local server needed)
- `ssi-scoreboard-local` -- calls `localhost:3000` (requires `pnpm dev` running)

Claude Code picks up `.mcp.json` automatically when you open the repo.

For client-specific setup (Claude Desktop, generic HTTP clients), example prompts, and
troubleshooting, see **[docs/mcp.md](docs/mcp.md)**.

## Architecture

```
Browser -> Next.js Route Handlers -> shootnscoreit.com/graphql/
         ^
    POST /api/mcp (MCP clients / Claude)
```

The `SSI_API_KEY` lives server-side only and is never sent to the browser. Route Handlers
are the only place that touches the upstream GraphQL API.

Two persistence layers:
- **Redis** (ioredis on Docker, @upstash/redis on Cloudflare) -- hot cache for active matches and per-request data.
- **AppDatabase** (SQLite on Docker, D1 on Cloudflare) -- durable store for shooter profiles, match indices, achievements, and historical match data offloaded from Redis.

Key entry-points:
- `app/api/match/[ct]/[id]/` -- match metadata (stages, competitors, scoring progress)
- `app/api/compare/` -- fans out scorecard queries, merges ranking data
- `app/api/events/` -- event search with date-range, firearms, country, level filters
- `app/api/shooter/[shooterId]/` -- cross-competition shooter dashboard
- `app/api/og/match/[ct]/[id]/` -- dynamic Open Graph images
- `app/api/mcp/` -- MCP HTTP endpoint (JSON-RPC, single-shot transport)
- `app/api/coaching/` -- AI coaching tips
- `app/api/admin/cache/` -- authenticated cache purge / health / force-refresh

For the full module layout and contributor conventions, see [`CLAUDE.md`](CLAUDE.md).

## Design System

This project uses **Tailwind v4** with CSS custom property design tokens (OKLCH color space)
defined in `app/globals.css`. Always use semantic token classes (`bg-background`,
`text-muted-foreground`, etc.) rather than raw palette classes (`bg-gray-100`).
Dark mode is supported via `next-themes` and the `.dark` class -- all tokens have light
and dark values. A theme toggle in the toolbar lets users switch at runtime.

shadcn/ui is the primary component library. Never modify files in `components/ui/`
directly; use `pnpm dlx shadcn@latest add` to update them.

## Accessibility

This project targets **WCAG 2.1 AA** compliance:
- All interactive elements are keyboard-navigable with a visible focus ring
- Minimum touch target size 44x44px (enforced globally in `globals.css`)
- Error states use `role="alert"` for screen reader announcements
- Color is never the only means of conveying information -- pairs with shape, icon, or pattern
- Semantic HTML throughout (`<button>`, `<table>`, `<th scope>`, etc.)

## Support

If this tool saves you time at the range, consider buying me a coffee:

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://buymeacoffee.com/thias)
