# SSI Scoreboard

Live stage-by-stage comparison tool for IPSC competitions on [shootnscoreit.com](https://shootnscoreit.com).

The official site only lets you view one competitor at a time. This app lets you select
any group of competitors and compare their results across every stage side-by-side —
including during an active match before official results are published.

## Prerequisites
- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10.30.1 --activate`)
- A ShootNScoreIt API key (account settings on shootnscoreit.com)

## Local Setup
```bash
pnpm install
cp .env.local.example .env.local   # then fill in SSI_API_KEY
pnpm dev                            # http://localhost:3000
```

## Deployment

### Docker / Docker Compose
```bash
cp .env.local.example .env.local   # fill in SSI_API_KEY, CACHE_PURGE_SECRET
pnpm docker:build                   # builds image
pnpm docker:up                      # starts redis + app on port 3000
```

`REDIS_URL` is set automatically via the compose service name — no manual entry needed.
A `redis_data` volume persists the cache across container restarts.

**Without Docker Compose** (bare server, Kubernetes, Fly.io): run a Redis instance and set
`REDIS_URL` to its connection string (`rediss://` for TLS). The app uses `lazyConnect: true`
so a missing Redis at startup is non-fatal — requests fall back to direct GraphQL fetches.

### Cloudflare Pages

The app has first-class Cloudflare Pages support. The build target is selected at build time
via `DEPLOY_TARGET=cloudflare` — no source changes needed. Cloudflare Workers cannot open
TCP connections, so the Docker/Node.js `ioredis` adapter is replaced at build time with an
HTTP-based `@upstash/redis` adapter — you will need an [Upstash](https://upstash.com)
Redis database.

```bash
pnpm cf:build    # DEPLOY_TARGET=cloudflare + @opennextjs/cloudflare build
pnpm cf:deploy   # build + wrangler deploy
```

For a full step-by-step walkthrough — including wrangler login, setting secrets, adding a
custom subdomain, verifying the deployment, and troubleshooting — see
**[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)**.

## Environment Variables

| Variable | Target | Description |
|---|---|---|
| `SSI_API_KEY` | Both | ShootNScoreIt API key — server-side only, never exposed to browser |
| `CACHE_PURGE_SECRET` | Both | Secret for the admin cache-purge endpoint — any strong random string |
| `NEXT_PUBLIC_BUILD_ID` | Both | Git SHA baked into the bundle at build time for version detection (auto-injected by `pnpm docker:build`) |
| `REDIS_URL` | Docker | Redis connection string (`redis://localhost:6379` locally, `rediss://…` for cloud). Not needed for CF builds. |
| `UPSTASH_REDIS_REST_URL` | Cloudflare | REST URL from the Upstash console (see setup above) |
| `UPSTASH_REDIS_REST_TOKEN` | Cloudflare | REST token from the Upstash console (see setup above) |

## Usage
1. Browse upcoming or recent competitions via the built-in event search, or paste a match URL
   (e.g. `https://shootnscoreit.com/event/22/26547/`) directly into the input field
2. Search for and select up to 10 competitors by name, number, or club
3. Multiple analysis views update immediately:
   - **Stage table** — hit factors, raw points, time, A/C/D/M hit zone breakdown, rank, percentile
     placement, shooting order, stage difficulty, and run classification per stage; switch to
     **delta heatmap** view to see each cell relative to the group leader
   - **Hit factor chart** — bar chart per stage with optional field-leader benchmark line
   - **HF% vs stage winner** — line chart showing each competitor's performance relative to the
     stage winner across every stage
   - **Speed vs. accuracy scatter** — time/points tradeoff with iso-HF reference lines
   - **Stage balance radar** — consistency across stages as a polar chart
   - **Coaching panels** — consistency score, efficiency (points per shot), penalty rate and
     match-percentage impact, points left on the table, and "one stage away" what-if analysis
   - **Shooter style fingerprint** — alpha ratio vs. points-per-second scatter with field cohort
     overlay and archetype labels
   - **Shooter style radar** — composure, consistency, and full style profile as a polar chart
4. Share the comparison via the share button — the `?competitors=` URL encodes the selection

## Features
- **Live data** — works during active matches before official results are published
- **Dark mode** — toggle between light and dark themes
- **Group / Division / Overall rankings** — toggle the ranking context in the stage table
- **Delta heatmap** — colour-coded table view showing each cell relative to the group leader
- **Percentile placement** — P-rank label shows each competitor's field percentile per stage
- **Stage difficulty** — 1–5 difficulty rating derived from full-field median HF context
- **Stage run classification** — solid / conservative / over-push / meltdown label per cell
- **Shooting order** — per-competitor stage sequence number shown in each cell
- **Incomplete scorecard flag** — visual indicator for partially-scored stages (IPSC rule 9.7.6.2)
- **Benchmark overlay** — optional field-leader reference line on the hit factor chart
- **HF% vs stage winner chart** — line chart of relative performance across every stage
- **Consistency score** — coefficient of variation of HF% across fired stages
- **Efficiency metric** — points per shot fired
- **Penalty rate & impact** — penalty frequency and match-percentage cost
- **Points left on the table** — hit quality vs. penalty breakdown per stage
- **What-if analysis** — "one stage away": how a clean stage would move each competitor's ranking
- **Shooter style fingerprint** — alpha ratio vs. PPS scatter with field cohort and archetypes
- **Shooter style radar** — composure, consistency, and full multi-axis style profile
- **Cell help modal** — annotated guide to every data point in the comparison table
- **Info popovers** — `?` button on every chart explains axes, reading tips, and interpretation
- **Hit zone bars** — proportional A/C/D/M visualization per stage and in the totals row
- **Penalty display** — misses, no-shoots, and procedurals with exact point deductions
- **DQ detection** — banner alert when a competitor is match-disqualified
- **Clean match indicator** — badge in the totals row when all fired stages are penalty-free
- **Stage metadata** — round count, paper targets, steel targets, links to SSI stage pages
- **Shareable URLs** — `?competitors=` query param persists and shares selections
- **Recent matches** — localStorage-backed list of recently viewed competitions
- **Firearms filter** — filter event search by Handgun+PCC, PCC only, Rifle, or Shotgun
- **Country filter** — filter event search by country (ISO 3166-1 alpha-3), defaults to Sweden (SWE)
- **Extended date range** — event search window up to 5 years back (Upcoming / 3 mo / 6 mo / 1 yr / 2 yr / 3 yr / 5 yr)
- **Server-side cache** — GraphQL response caching with smart TTL and admin purge endpoint; ioredis on Docker, @upstash/redis on Cloudflare Pages
- **New-version banner** — polls `/api/version` every 60 s; shows a non-blocking refresh prompt when a new deployment is detected
- **Mobile-first** — designed for one-handed use at 390px; no unintentional horizontal overflow

## Development Commands
```bash
pnpm dev          # start dev server on port 3000
pnpm build        # production build
pnpm lint         # ESLint — zero warnings required
pnpm typecheck    # TypeScript type check — zero errors required
pnpm test         # Vitest unit + component tests
pnpm test:watch   # Vitest in watch mode
pnpm test:e2e     # Playwright E2E tests (mocked API, no live key needed)
pnpm test:e2e:ui  # Playwright with interactive UI
```

**Quality bar:** `pnpm lint`, `pnpm typecheck`, and `pnpm test` must all pass with **zero
errors and zero warnings** before merging. CI enforces this.

## Architecture
```
Browser → Next.js Route Handlers → shootnscoreit.com/graphql/
```

- **`app/api/match/[ct]/[id]/`** — match metadata: stages, competitors, scoring progress
- **`app/api/compare/`** — fans out scorecard queries, merges ranking data
- **`app/api/events/`** — event search with date range, firearms, and country filters
- **`app/api/admin/cache/purge/`** — authenticated endpoint to flush the Redis cache
- **`app/api/compare/logic.ts`** — pure `computeGroupRankings()` function, no I/O, fully unit-tested
- **`lib/graphql.ts`** — GraphQL query strings and `executeQuery()` helper (server-only)
- **`lib/cache.ts`** — `CacheAdapter` interface; `lib/cache-node.ts` (ioredis) and `lib/cache-edge.ts` (@upstash/redis) are the two implementations; `lib/cache-impl.ts` selects between them at build time
- **`lib/types.ts`** — single source of truth for all TypeScript interfaces
- **`lib/queries.ts`** — TanStack Query v5 hooks used by client components
- **`components/`** — all UI; no direct API calls, all data via hooks from `lib/queries.ts`

The `SSI_API_KEY` lives server-side only and is never sent to the browser.

## Design System
This project uses **Tailwind v4** with CSS custom property design tokens (OKLCH color space)
defined in `app/globals.css`. Always use semantic token classes (`bg-background`,
`text-muted-foreground`, etc.) rather than raw palette classes (`bg-gray-100`).
Dark mode is supported via `next-themes` and the `.dark` class — all tokens have light and
dark values. A theme toggle in the toolbar lets users switch at runtime.

shadcn/ui is the primary component library. Never modify files in `components/ui/` directly;
use `pnpm dlx shadcn@latest add` to update them.

## Accessibility
This project targets **WCAG 2.1 AA** compliance:
- All interactive elements are keyboard-navigable with a visible focus ring
- Minimum touch target size 44×44px (enforced globally in `globals.css`)
- Error states use `role="alert"` for screen reader announcements
- Color is never the only means of conveying information
- Semantic HTML throughout (`<button>`, `<table>`, `<th scope>`, etc.)

## Other deployment targets

**Vercel:** Connect the repo, add `SSI_API_KEY`, `REDIS_URL`, and `CACHE_PURGE_SECRET` as
environment variables. pnpm is auto-detected from `packageManager` in `package.json`.
Use `rediss://` for a managed Redis (e.g. Upstash) — Vercel's environment does not include
a Redis instance by default.

**Cloudflare Pages / Docker:** see the [Deployment](#deployment) section above.
