# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Commands
```bash
pnpm dev          # start Next.js dev server (port 3000)
pnpm build        # production build
pnpm lint         # ESLint (eslint .) — zero warnings required
pnpm typecheck    # tsc --noEmit — zero errors required
pnpm test         # vitest run (unit + component)
pnpm test:watch   # vitest watch mode
pnpm test:e2e     # playwright test (mocked API, no live key needed)
pnpm test:e2e:ui  # playwright --ui
```

**All checks must pass cleanly:** `pnpm typecheck && pnpm test` must produce zero errors
and zero warnings before committing. `pnpm lint` must also produce zero warnings.

## Architecture

Next.js 15 full-stack app. Route Handlers in `app/api/` are the only place that call
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
- `lib/graphql.ts` — GQL query strings + `executeQuery()`, server-only (no NEXT_PUBLIC_ prefix)
- `lib/cache.ts` — `CacheAdapter` interface (get/set/persist/del/scanRecentKeys)
- `lib/cache-node.ts` — ioredis implementation (Docker / Node.js target)
- `lib/cache-edge.ts` — @upstash/redis HTTP implementation (Cloudflare Pages target)
- `lib/cache-impl.ts` — re-exports node adapter by default; CF builds override via webpack alias
- `lib/types.ts` — single source of truth for all TypeScript interfaces
- `lib/queries.ts` — TanStack Query v5 hooks used by client components
- `components/` — all UI; no direct API calls, all data via hooks from `lib/queries.ts`

## GraphQL Patterns
The SSI API uses Django content-type discrimination. Match URLs encode this:
`https://shootnscoreit.com/event/{content_type}/{id}/`

- IPSC matches: `content_type = 22`
- All queries use inline fragments: `... on IpscMatchNode { }`, `... on IpscCompetitorNode { }`
- `get_results` (official standings) is blocked during active matches — use raw scorecard data instead
- Scorecard data is available via `event -> stages -> scorecards` path

## Testing Approach
- **Unit tests** (`tests/unit/`): pure functions only — `parseMatchUrl`, `buildColorMap`, `computeGroupRankings`
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

## Chart info popovers
Every chart section in `app/match/[ct]/[id]/page.tsx` has a `?` (`HelpCircle`) icon button
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

## Environment Variables
| Variable | Where used | Target | Notes |
|---|---|---|---|
| `SSI_API_KEY` | `lib/graphql.ts` (server-only) | Both | Never use `NEXT_PUBLIC_` prefix |
| `CACHE_PURGE_SECRET` | `app/api/admin/cache/purge/route.ts` | Both | Any strong random string; never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_BUILD_ID` | `components/update-banner.tsx`, `app/api/version/route.ts` | Both | Git SHA baked into the client bundle at Docker build time; powers new-version detection. Auto-injected by `pnpm docker:build`. Unset in `pnpm dev` — version check is skipped. |
| `REDIS_URL` | `lib/cache-node.ts` | Docker only | `redis://localhost:6379` locally, `rediss://...` for managed Redis. Not needed for CF builds. |
| `UPSTASH_REDIS_REST_URL` | `lib/cache-edge.ts` | Cloudflare only | REST URL from Upstash console. Set via `wrangler secret put` in production. |
| `UPSTASH_REDIS_REST_TOKEN` | `lib/cache-edge.ts` | Cloudflare only | REST token from Upstash console. Set via `wrangler secret put` in production. |

## Package Manager
This project uses **pnpm@10.30.1**. Do not use npm or yarn. Use `pnpm add` / `pnpm add -D`.
When adding new packages, always specify the exact latest stable version (check with `npm show <pkg> version`).

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
