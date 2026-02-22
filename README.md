# SSI Scoreboard

Live stage-by-stage comparison tool for IPSC competitions on [shootnscoreit.com](https://shootnscoreit.com).

The official site only lets you view one competitor at a time. This app lets you select
any group of competitors and compare their results across every stage side-by-side —
including during an active match before official results are published.

## Prerequisites
- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
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
docker compose up --build           # builds and runs on port 3000
```

## Environment Variables
| Variable | Description |
|---|---|
| `SSI_API_KEY` | ShootNScoreIt API key — server-side only, never exposed to browser |

## Usage
1. Open a match on shootnscoreit.com, copy the URL (e.g. `https://shootnscoreit.com/event/22/26547/`)
2. Paste it into the app's input field
3. Search for and select up to 10 competitors
4. The comparison table and chart update immediately

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
- **`app/api/`** — Next.js Route Handlers proxy all ShootNScoreIt GraphQL calls server-side.
  The `SSI_API_KEY` is never sent to the browser.
- **`app/api/compare/logic.ts`** — Pure function for group ranking computation, separately testable.
- **`lib/graphql.ts`** — GraphQL query strings and `executeQuery()` helper (server-only).
- **`lib/types.ts`** — Single source of truth for all TypeScript interfaces.
- **`components/`** — UI components. All data fetching goes through TanStack Query hooks in `lib/queries.ts`.

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
