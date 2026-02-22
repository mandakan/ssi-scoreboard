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

## Docker / Docker Compose
```bash
cp .env.local.example .env.local   # fill in SSI_API_KEY
pnpm docker:build                   # builds image
pnpm docker:up                      # runs on port 3000
```

## Environment Variables
| Variable | Description |
|---|---|
| `SSI_API_KEY` | ShootNScoreIt API key — server-side only, never exposed to browser |

## Usage
1. Browse upcoming or recent competitions via the built-in event search, or paste a match URL
   (e.g. `https://shootnscoreit.com/event/22/26547/`) directly into the input field
2. Search for and select up to 10 competitors by name, number, or club
3. Four views update immediately:
   - **Stage table** — hit factors, raw points, time, A/C/D/M hit zone breakdown, and rank per stage
   - **Hit factor chart** — bar chart per stage with optional field-leader benchmark line
   - **Speed vs. accuracy scatter** — time/points tradeoff with iso-HF reference lines
   - **Stage balance radar** — consistency across stages as a polar chart
4. Share the comparison via the share button — the `?competitors=` URL encodes the selection

## Features
- **Live data** — works during active matches before official results are published
- **Group / Division / Overall rankings** — toggle the ranking context in the stage table
- **Benchmark overlay** — optional field-leader reference line on the hit factor chart
- **Hit zone bars** — proportional A/C/D/M visualization per stage and in the totals row
- **Penalty display** — misses, no-shoots, and procedurals with exact point deductions
- **DQ detection** — banner alert when a competitor is match-disqualified
- **Clean match indicator** — badge in the totals row when all fired stages are penalty-free
- **Stage metadata** — round count, paper targets, steel targets, links to SSI stage pages
- **Shareable URLs** — `?competitors=` query param persists and shares selections
- **Recent matches** — localStorage-backed list of recently viewed competitions
- **Firearms filter** — filter event search by Handgun+PCC, PCC only, Rifle, or Shotgun
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
- **`app/api/events/`** — event search with date range and firearms filters
- **`app/api/compare/logic.ts`** — pure `computeGroupRankings()` function, no I/O, fully unit-tested
- **`lib/graphql.ts`** — GraphQL query strings and `executeQuery()` helper (server-only)
- **`lib/types.ts`** — single source of truth for all TypeScript interfaces
- **`lib/queries.ts`** — TanStack Query v5 hooks used by client components
- **`components/`** — all UI; no direct API calls, all data via hooks from `lib/queries.ts`

The `SSI_API_KEY` lives server-side only and is never sent to the browser.

## Design System
This project uses **Tailwind v4** with CSS custom property design tokens (OKLCH color space)
defined in `app/globals.css`. Always use semantic token classes (`bg-background`,
`text-muted-foreground`, etc.) rather than raw palette classes (`bg-gray-100`).
Dark mode is supported via the `.dark` class — all tokens have light and dark values.

shadcn/ui is the primary component library. Never modify files in `components/ui/` directly;
use `pnpm dlx shadcn@latest add` to update them.

## Accessibility
This project targets **WCAG 2.1 AA** compliance:
- All interactive elements are keyboard-navigable with a visible focus ring
- Minimum touch target size 44×44px (enforced globally in `globals.css`)
- Error states use `role="alert"` for screen reader announcements
- Color is never the only means of conveying information
- Semantic HTML throughout (`<button>`, `<table>`, `<th scope>`, etc.)

## Deployment
**Vercel:** Connect the repo, add `SSI_API_KEY` as an environment variable.
pnpm is auto-detected from `packageManager` in `package.json`.

**Docker:** See Docker section above. The multi-stage Dockerfile produces a minimal
production image using `output: "standalone"` in `next.config.ts`.
