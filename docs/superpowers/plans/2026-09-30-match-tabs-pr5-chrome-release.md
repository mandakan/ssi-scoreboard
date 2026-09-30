# Match Tabs PR 5 -- Chrome, Desktop and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the match-tabs restructure so it can ship as one release: What's New as a dot instead of an auto-opening modal, banners that sit above the bottom bar, desktop match tabs at the top, the grid's missing error and "scores not public" states, docs, and the user-facing `RELEASES` entry.

**Architecture:** `WhatsNewProvider` exposes `hasUnseen` (hydration-safe `useSyncExternalStore` over localStorage) and stops auto-opening; `BottomNav`'s More item and a new desktop header entry render a dot. `MatchTabBar` is one `<nav>` that renders as a bottom bar below `md` and a top strip at `md+`. Grid states live in `grid-page-client.tsx` / `live-grid.tsx`.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5 (global `retry: 1` in `components/providers.tsx`), Tailwind v4, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md` Section 4 (What's New, banners, desktop, rollout item 5) and Section 2 ("Live scores not public: grid area explains and links to Info"). Predecessors: #561, #563, #565, #566.

## Global Constraints

- HARD (user): no change may increase calls to the SSI upstream API. This PR adds no queries. The grid error state's Retry calls `refetch()` once per tap -- no automatic retry loop beyond the existing global `retry: 1`. Every new `<Link>` into a match route uses `prefetch={false}`.
- Mobile-first 390px, no horizontal overflow, 44px targets, >=12px labels, WCAG 2.1 AA incl. 1.4.1 (the What's New dot is decoration; the accessible name says "new").
- Only one landmark per purpose: the match tab bar is ONE `<nav aria-label="Match sections">` at every breakpoint (restyled, not duplicated).
- localStorage reads hydration-safe; writes in try/catch.
- ASCII punctuation in new copy/comments (no literal "--" in UI text). Release copy follows the user's plain-prose rules: no "seamless", "leverage", "robust", etc.
- Gate before each commit: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test`; e2e with `SSI_UPSTREAM_PAUSED=on`. Known unrelated flake: "My Shooters drawer closes on overlay click".
- PR title: `feat(release): what's new dot, desktop match tabs and the match tabs release entry`. After merge, the release PR (#564 or its successor) can be merged -- that is the user's call.

## Decisions made while planning

- **Banner offset without a CSS variable.** Both bottom bars (global `BottomNav`, match tab bar) are `h-14` plus the safe-area inset, so banners use `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` below `md` and `md:bottom-0`. The spec's `--bottom-chrome-h` variable is unnecessary while the heights match; a comment records the coupling.
- **Missed releases.** Opening What's New while `hasUnseen` shows every release since the stored id (today's auto-open logic, moved to open time); otherwise it shows the latest.

## Review Focus

- A first-time visitor (no stored id) sees the dot but no modal on any page, including `/match/*`. Test in Task 1 (e2e).
- Opening What's New from the dot marks it seen: the dot disappears without a reload, and stays gone after reload. Test in Task 1.
- At 1280x900 the grid tab shows the tab strip at the top, no bottom bar, and no vertical page scroll (the grid fits the viewport). Test in Task 3.
- The grid's error state appears when `/api/live-grid` returns 500 after opt-in, and Retry issues exactly one request per tap. Test in Task 4.
- Install/update banners never cover the match tab bar at 390px. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `components/whats-new-provider.tsx` | No auto-open; `hasUnseen`; open shows missed releases and marks seen. |
| `components/bottom-nav.tsx`, `components/site-header.tsx` | Dot on More; desktop header "What's new" entry with dot. |
| `components/install-banner.tsx`, `components/update-banner.tsx` | Safe-area offset; z-order below dialogs. |
| `components/match-tab-bar.tsx`, `components/match-shell.tsx`, `app/match/[ct]/[id]/page.tsx` | Desktop top strip; heights; grid max width. |
| `app/match/[ct]/[id]/grid-page-client.tsx`, `components/live-grid.tsx` | Scores-not-public Info link; error state. |
| `lib/releases.ts`, `docs/whats-new.md`, `docs/live-grid.md`, `CLAUDE.md`, `scripts/screenshot-match.ts` | Release entry and docs. |

Branch: `git checkout main && git pull && git checkout -b feat/match-tabs-release` (commit this plan first).

---

### Task 1: What's New as a dot

**Files:**
- Modify: `components/whats-new-provider.tsx`, `components/bottom-nav.tsx` (More item + "What's new" row inside the More sheet), `components/site-header.tsx` (desktop "What's new" button)
- Test: `tests/components/whats-new-provider.test.tsx` (create or extend), `tests/e2e/scoreboard.spec.ts` or `tests/e2e/whats-new.spec.ts` (create)

**Interfaces:**
- Produces: `useWhatsNew(): { open: boolean; setOpen(open: boolean): void; hasUnseen: boolean }`.

- [ ] **Step 1: Failing unit tests** -- render `WhatsNewProvider` with a probe using `useWhatsNew()`:
  - with empty localStorage: `hasUnseen` true and no dialog is rendered after timers flush (`vi.useFakeTimers()` + `vi.runAllTimers()`);
  - with `whats-new-seen-id` = `RELEASES[0].id`: `hasUnseen` false;
  - `setOpen(true)` renders the dialog; closing it stores `RELEASES[0].id` and `hasUnseen` becomes false in the same render tree (no reload);
  - with the stored id equal to `RELEASES[1].id`, opening shows `RELEASES[0]` only; with a stored id two releases back, it shows the two missed releases (mirror today's `seenIndex` logic).
  Run -- Expected: FAIL (auto-open still happens; `hasUnseen` missing).

- [ ] **Step 2: Implement** -- remove the auto-open effect. `hasUnseen` = `useSyncExternalStore(subscribe, () => safeGet(LS_KEY) !== latest?.id, () => false)` where `subscribe` listens to `storage` and a module-level custom event `WHATS_NEW_SEEN` dispatched by `handleClose` after writing. `setOpen(true)` computes `releasesToShow` from the stored id (missed releases when unseen, else `[latest]`), then opens. Keep the blur-before-open behaviour.

- [ ] **Step 3: Dots** --
  - `BottomNav`: the More `NavButton` gets a dot when `hasUnseen`: an `aria-hidden` `span` (`absolute top-2 right-[calc(50%-14px)] h-2 w-2 rounded-full bg-primary`) and the button's accessible name becomes "More, new release notes"; inside the More sheet the "What's new" row shows the same dot and the text "New".
  - `SiteHeader` (desktop, `hidden md:flex`): add a "What's new" ghost button (lucide `Sparkles`, `aria-hidden`) calling `setOpen(true)`, with the dot and accessible name "What's new, new release notes" when `hasUnseen`.
  Component test: dot + accessible name appear only when `hasUnseen`.

- [ ] **Step 4: e2e** -- new `tests/e2e/whats-new.spec.ts` at 390x844 WITHOUT the usual `whats-new-seen-id` suppression: visit `/` and `/match/22/88888888` (reuse the grid mocks from `tests/e2e/live-grid.spec.ts`; the match route has no bottom nav, so check the dot on `/`): no `role="dialog"` appears within 1.5s; on `/` the More button's name matches /new release notes/; open More -> What's new -> dialog shows; close; the name no longer matches; reload; still no dot.

- [ ] **Step 5: Verify and commit**

```bash
git add components/whats-new-provider.tsx components/bottom-nav.tsx components/site-header.tsx tests
git commit -m "feat(whats-new): a dot instead of an auto-opening dialog"
```

---

### Task 2: Banners above the bottom bar

**Files:** `components/install-banner.tsx`, `components/update-banner.tsx`; Test: `tests/components/banners.test.tsx` (create), `tests/e2e/match-tabs.spec.ts`

- [ ] **Step 1: Failing test** -- a component test that renders each banner in its visible state (read each component to see how to force visibility: `InstallBanner` listens for `beforeinstallprompt`; `UpdateBanner` for a service-worker update -- dispatch/mocks accordingly) and asserts the root has `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]`, `md:bottom-0`, and `z-40` (UpdateBanner currently `z-50`, which paints over sheets/dialogs).
- [ ] **Step 2: Implement** -- replace `bottom-14` with `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` in both; UpdateBanner `z-50` -> `z-40`. Add a one-line comment in each: both bottom bars (BottomNav, MatchTabBar) are h-14 plus the safe-area inset; keep in sync.
- [ ] **Step 3: e2e** -- in `match-tabs.spec.ts` at 390px, force the UpdateBanner visible using the same trigger as the component test (via `page.evaluate` dispatching the event the component listens for); assert the banner's bounding box bottom <= the tab bar's top.
- [ ] **Step 4: Verify and commit** -- `git commit -m "fix(ui): banners sit above the bottom bar and below dialogs"`

---

### Task 3: Desktop match tabs at the top

**Files:** `components/match-tab-bar.tsx`, `components/match-shell.tsx`, `app/match/[ct]/[id]/page.tsx`, `components/live-grid.tsx` (max width); Test: `tests/components/match-tab-bar.test.tsx`, `tests/e2e/match-tabs.spec.ts`

- [ ] **Step 1: Failing e2e** at 1280x900 (`test.use` inside a `describe`): on `/match/22/88888888` (identity seeded, live fixture) the `nav[aria-label="Match sections"]` bounding box top is < 200px (below the site header and top bar, not at the bottom); exactly one such nav exists; `document.documentElement.scrollHeight <= window.innerHeight + 1` (no vertical page scroll on the grid tab); on `/match/22/88888888/analysis` the nav is also at the top. Run -- Expected: FAIL (bar is at the bottom).
- [ ] **Step 2: Implement** --
  - `MatchTabBar`: keep one `<nav>`; classes: mobile `fixed bottom-0 inset-x-0 z-40 border-t ...` as today; `md:static md:border-t-0 md:border-b md:bg-background` with the inner row `md:h-11 md:justify-start md:gap-1 md:px-4`, links `md:flex-none md:flex-row md:gap-1.5 md:px-3 md:rounded-md` and the active link `md:bg-muted`. Safe-area padding only below md (`md:pb-0`).
  - `MatchShell`: render `MatchTabBar` directly after `TopBar` in DOM order (so the desktop strip sits under the top bar; on mobile it is `fixed` so DOM order does not matter), make it `md:sticky md:top-[6.5rem]` (site header 3.5rem + top bar 3rem) with the top bar `md:top-14` as today; `main` padding-bottom only below md (`pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0`) and `md:min-h-[calc(100dvh-3.5rem)]` (fixes the deferred 3.5rem desktop scroll from PR 2).
  - Grid page wrapper (`app/match/[ct]/[id]/page.tsx`): mobile height unchanged; md: `md:h-[calc(100dvh-3.5rem-3rem-2.75rem)]` (site header, top bar, tab strip).
  - `LiveGrid`: outer container `md:mx-auto md:max-w-5xl md:w-full` so the table does not stretch across a wide screen.
  - Tab-view telemetry and `prefetch={false}` unchanged.
- [ ] **Step 3: Component test** -- still exactly one nav landmark, links keep `aria-current`, `prefetch={false}`.
- [ ] **Step 4: Verify** -- the whole e2e suite (mobile tests must still pass unchanged) -- and commit `feat(match): desktop match tabs as a top strip`.

---

### Task 4: Grid error state and "scores not public" link

**Files:** `components/live-grid.tsx`, `app/match/[ct]/[id]/grid-page-client.tsx`; Test: `tests/components/live-grid.test.tsx`, `tests/e2e/match-tabs.spec.ts`

- [ ] **Step 1: Failing tests**
  - Component: when `useLiveGridQuery` (mocked) returns `{ isError: true, data: undefined, refetch }` and no `staticData`, LiveGrid renders `role="alert"` "Could not load live scores." and a 44px "Retry" button; clicking it calls `refetch` exactly once. When the query errors but `placeholder` data exists, the placeholder grid still renders with a compact `role="alert"` notice above the table (not a blank screen).
  - e2e: live fixture with identity; route `/api/live-grid` to 500; expect the alert; count requests; click Retry once; expect exactly one additional request.
  - "Scores not public" state: the grid-page block gains a `Link` "Match info" (`prefetch={false}`, `min-h-11`) to the Info tab; component or e2e assertion on its href and that it has no prefetch (mock `next/link` as in `tests/components/match-tab-bar.test.tsx`).
- [ ] **Step 2: Implement** -- in LiveGrid: `if (query.isError && !staticData)` render the alert (with Retry calling `query.refetch()`) in place of the table when there is no placeholder, or above the table when there is. No change to query options. In grid-page-client: add the Info link to the "Match in progress" block.
- [ ] **Step 3: Verify and commit** -- `git commit -m "feat(grid): error state with retry and an info link when scores are not public"`

---

### Task 5: Release entry and docs

**Files:** `lib/releases.ts`, `docs/whats-new.md`, `docs/live-grid.md`, `CLAUDE.md`, `scripts/screenshot-match.ts`

- [ ] **Step 1: Release entry** -- prepend to `RELEASES` and update `LATEST_RELEASE_ID`:

```ts
export const LATEST_RELEASE_ID = "2026-10-match-tabs";

  {
    id: LATEST_RELEASE_ID,
    date: "October 2026",
    title: "One match, three tabs: Grid, Info and Analysis",
    screenshotScenes: ["live-grid", "comparison-table", "stage-times-export"],
    sections: [
      {
        heading: "The grid is the match page",
        items: [
          "Opening a match now lands on the courtside grid for every match, before, during and after scoring. A tab bar at the bottom switches between Grid, Info and Analysis.",
          "Before scoring starts the grid shows your squad's rows with empty cells, plus your squad, your first stage and the weather. Tap Show live scores when you want results loaded.",
          "Bigger text and larger tap targets throughout the grid, and a Live button that jumps to the stage being shot now.",
        ],
      },
      {
        heading: "Analysis, tidied",
        items: [
          "Who you compare is one line at the top. Tap it to pick shooters, apply a squad or benchmark, or reset to the shooters from your grid.",
          "The five charts share one card. Switch between them with the chips above the chart; your last choice is remembered.",
          "Coaching analyses, the stage-time export and the stage simulator live in a Deep dive section that stays closed until you open it.",
        ],
      },
      {
        heading: "Also",
        items: [
          "Match info collects the match details, notices, squad rotation, weather and the AI brief in one place.",
          "What's new no longer pops up. A dot on More (or in the header on desktop) tells you when there is something new.",
          "On a computer the match tabs sit at the top of the page.",
        ],
      },
    ],
  },
```

  If a `Release` field above does not exist in `lib/types.ts`, match the type. Keep every existing entry.

- [ ] **Step 2: Docs** --
  - `docs/whats-new.md`: replace the auto-show description with the dot behaviour; key files list now includes `bottom-nav.tsx` and `site-header.tsx`; remove the claim that the footer is the entry point (the footer is hidden on match pages).
  - `docs/live-grid.md`: replace "Full analysis" references with the Analysis tab; the rail is a progress strip plus a Live jump button; pre-match empty grid (no fetch until opt-in); layout constants in `components/live-grid-layout.ts`.
  - `CLAUDE.md`: the "What's New dialog" section says it no longer auto-shows (dot on More / header); the "Courtside Grid" section mentions the match tabs (Grid is the index route; Analysis and Info are sibling routes; mention the pre-match no-fetch rule and `prefetch={false}` on links into match routes as part of the SSI constraint).
- [ ] **Step 3: Screenshot scenes** -- add a `match-info` scene (goto `${matchPath}/info`, wait for the "Your squad" heading) and a `pre-match-grid` scene (seed identity, use a pre-match mock match if `scripts/release-mock-data.ts` allows overriding `scoring_pct`/`match_status`; if it does not, skip this scene and say so in the report). Update the scene catalogue in `docs/whats-new.md` and `docs/release-post.md`. Then start the dev server in the background and run `pnpm release:screenshots` once for the scenes in the new release entry; confirm the PNGs are produced in the (gitignored) output directory and look at 2 of them (Read the image files) to confirm the new UI is captured. Stop the dev server.
- [ ] **Step 4: Verify and commit** -- gate + full e2e; `git commit -m "docs(release): match tabs release entry, docs and screenshot scenes"`

---

### Task 6: Open the PR

- [ ] Push `feat/match-tabs-release`; `gh pr create --base main --title "feat(release): what's new dot, desktop match tabs and the match tabs release entry" --body-file ~/.claude-tmp/pr5-body.md`. Body: **Why** (PR 5 of 5; after this merges the held release PR can ship the whole restructure), **What**, **Decisions**, **SSI upstream impact** (no new queries; Retry is one request per tap; all new match links `prefetch={false}`), **Tests**, **Release note** (quote the `RELEASES` entry). End with the Claude Code attribution footer.
