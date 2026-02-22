# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Commands
```bash
pnpm dev          # start Next.js dev server (port 3000)
pnpm build        # production build
pnpm lint         # ESLint via next lint
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (unit + component)
pnpm test:watch   # vitest watch mode
pnpm test:e2e     # playwright test
pnpm test:e2e:ui  # playwright --ui
```

Always run `pnpm typecheck` and `pnpm test` after making changes.

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
- `lib/types.ts` — single source of truth for all TypeScript interfaces
- `lib/queries.ts` — TanStack Query v5 hooks used by client components
- `components/` — all UI; no direct API calls, all data via hooks from `lib/queries.ts`

## GraphQL Patterns
The SSI API uses Django content-type discrimination. Match URLs encode this:
`https://shootnscoreit.com/event/{content_type}/{id}/`

- IPSC matches: `content_type = 22`
- All queries use inline fragments: `... on IpscMatchNode { }`, `... on IpscCompetitorNode { }`
- `get_results` (official standings) is blocked during active matches — use raw scorecard data instead
- Fetch competitors concurrently: `Promise.all(ids.map(id => fetchCompetitorScorecards(ct, id)))`

## Testing Approach
- **Unit tests** (`tests/unit/`): pure functions only — `parseMatchUrl`, `buildColorMap`, `computeGroupRankings`
- **Component tests** (`tests/components/`): React Testing Library, focus on conditional cell rendering
- **E2E tests** (`tests/e2e/`): Playwright with `route.fulfill()` to mock `/api/*` — no live API key needed in CI
- Extract I/O-free logic into separate files to keep unit tests fast and reliable
- CI runs: lint → typecheck → test → build → test:e2e

## Code Conventions
- All interfaces in `lib/types.ts` — do not define inline types in components
- `lib/graphql.ts` is server-only — never import it from client components
- Competitor colors are deterministic by index in `selectedIds` array (see `lib/colors.ts`)
- `group_leader_points` on `StageComparison` is reserved for the future benchmark overlay feature — do not remove
- shadcn components live in `components/ui/` — do not modify generated files directly, re-run `pnpm dlx shadcn@latest add` to update

## Environment Variables
| Variable | Where used | Notes |
|---|---|---|
| `SSI_API_KEY` | `lib/graphql.ts` (server-only) | Never use `NEXT_PUBLIC_` prefix |

## Package Manager
This project uses **pnpm@10.30.1**. Do not use npm or yarn. Use `pnpm add` / `pnpm add -D`.
When adding new packages, always specify the exact latest stable version (check with `npm show <pkg> version`).
