# Match Tabs PR 4 -- Grid Polish and Info Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Grid and Info tabs from spec Section 2: an empty grid before scoring starts (drawn without fetching), a compact pre-match strip, a 12px text floor and 44px targets in the grid, a Manage action for tracked shooters, and the Info tab reordered for every match state.

**Architecture:** Pure helpers (`lib/stage-rotation.ts`, `buildEmptyGrid()` in `lib/live-grid.ts`) feed the grid client. `LiveGrid` gains an optional `staticData` prop that disables its query and renders the given rows (field-blind, from match data only). Grid layout widths live in one module (`components/live-grid-layout.ts`) so the name column, scroll padding and cell widths cannot drift. Info keeps `PreMatchView`'s sub-components and only reorders them.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5, Tailwind v4, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md` Section 2 (grid states, Manage tracked, 12px floor, Info order), Section 1 (top-bar warning dot). Predecessors: #561, #563, #565.

## Global Constraints

- HARD (user): no change may increase calls to the SSI upstream API.
  - The pre-match grid is built from the already-loaded match (`useMatch()`): stages, competitors, squads. It must NOT mount `useLiveGridQuery` (or any SSI-backed query) until the user taps "Show live scores" -- same opt-in as today (`getLiveScoresOptIn` / `saveLiveScoresOptIn`, sessionStorage).
  - The strip's weather uses the existing `usePreMatchWeatherQuery` (Open-Meteo via `/api/pre-match/weather`, Next fetch revalidate 1h, geocoding cached in Redis) -- never SSI. It is the same query key Info already uses, so switching tabs does not refetch.
  - No new polling, prefetch, or refetch-on-focus.
- Field-blind grid contract (`docs/live-grid.md`): every grid value derives from one shooter's own data plus the stage list. `buildEmptyGrid` uses only competitor identity fields and stages.
- Mobile-first 390px, no horizontal page overflow; 44x44px touch targets; text >= 14px for values and >= 12px for secondary labels (CLAUDE.md). WCAG 1.4.1: never color alone.
- Tailwind utility classes only (arbitrary values allowed); no inline `style` except existing safe-area env() usages.
- ASCII punctuation in new copy/comments (no literal "--" in UI text).
- Gate before each commit: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test`; e2e with `SSI_UPSTREAM_PAUSED=on`. Known unrelated flake: "My Shooters drawer closes on overlay click".
- PR title: `feat(grid): pre-match grid, 12px floor and info tab order`. Release stays held until PR 5.

## Decisions made while planning (controller rulings, carried into tasks)

- **Stage rail becomes a progress indicator, not a row of jump buttons.** At 390px a 12-stage rail gives ~15px-wide buttons; 44x44 targets cannot fit one per stage. The rail keeps its visual (done / live / todo, plus the `n/m` count) as `aria-hidden` decoration with a text equivalent, and a single 44px "Live: S7" button jumps to the live-edge stage (hidden when there is no live edge). Other stages are reached by swiping the grid, which snaps correctly since #560.
- **Top-bar warning dot** shows only for "match cancelled" and "upstream degraded / paused". "Results not published" is true for the whole live phase, so a dot for it would always be on and mean nothing.
- **Grid name column** widens from 94px to 104px to fit the 12px division line.

## Review Focus

- Pre-match grid makes zero `/api/live-grid` and zero `/api/compare` requests before opt-in, and exactly the normal grid queries after it. Test in Task 3 (e2e request counting).
- A pre-match visitor with no identity, tracked shooters or saved selection still gets the "Pick your squad" state, not an empty table. Test in Task 3.
- The detail sheet opened from an empty pre-match cell shows "Not shot yet" rather than crashing on missing values. Test in Task 3.
- At 390px with 12 stages and the 104px name column there is no page overflow and every interactive grid element is >= 44px tall. Test in Task 2 (e2e).
- Info tab for a completed match still renders (squad, rotation, weather, field) without pre-match-only assumptions. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/stage-rotation.ts` (create) | Pure: `stageIndexForRound`, `squadRotation`, `squadForShooter`. Moved out of `components/pre-match-view.tsx`. |
| `lib/live-grid.ts` (modify) | Add pure `buildEmptyGrid(match, rowIds)`. |
| `components/live-grid-layout.ts` (create) | Class-string constants for the name column, scroll padding and cell min width. |
| `components/live-grid.tsx` (modify) | 12px floor, layout constants, rail as indicator + Live jump, Manage action, `staticData` prop. |
| `components/live-grid-cell.tsx`, `components/live-grid-sheet.tsx` (modify) | 12px floor. |
| `components/pre-match-strip.tsx` (create) | Squad, first stage, weather, Show live scores, link to Info. |
| `app/match/[ct]/[id]/grid-page-client.tsx` (modify) | Pre-match state renders strip + static grid. |
| `components/pre-match-view.tsx` (modify) | Section order; registered field collapsed. |
| `app/match/[ct]/[id]/info/info-page-client.tsx` (modify) | Facts, notices, then PreMatchView. |
| `components/match-shell.tsx` (modify) | Warning dot. |

Branch: `git checkout main && git pull && git checkout -b feat/grid-info-polish` (commit this plan first).

---

### Task 1: Pure helpers -- rotation and empty grid

**Files:**
- Create: `lib/stage-rotation.ts`, `tests/unit/stage-rotation.test.ts`
- Modify: `lib/live-grid.ts`, `tests/unit/live-grid.test.ts`, `components/pre-match-view.tsx` (import the moved helper; delete its local `getStageIndex`)

**Interfaces:**
- Produces:
  - `stageIndexForRound(squadNumber: number, round: number, totalStages: number): number` -- body of today's `getStageIndex` (`((squadNumber - 1) + (round - 1)) % totalStages`), same doc comment ("a prediction, not a guarantee").
  - `squadRotation<T extends { stage_number: number }>(squadNumber: number, stages: T[]): { round: number; stage: T }[]` -- sorts by `stage_number`, maps rounds 1..N.
  - `squadForShooter(match: Pick<MatchResponse, "squads" | "competitors">, shooterId: number | null): SquadInfo | null` -- the squad containing the competitor whose `shooterId` matches, else null.
  - `buildEmptyGrid(match: Pick<MatchResponse, "stages" | "competitors" | "squads">, rowIds: number[]): LiveGridResponse` -- `stages` from `match.stages` (`stage_id: s.id, stage_num: s.stage_number, name, max_points`), `shooters` in `rowIds` order from `match.competitors` (`id, shooterId, name, competitor_number, division, squad` = the squad's `name` or number as string, else null), `cells` = `{ [rowId]: {} }`, `cacheInfo: { cachedAt: null }`, `match_id: 0`. Unknown row ids are dropped.

- [ ] **Step 1: Failing tests** -- `tests/unit/stage-rotation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { squadForShooter, squadRotation, stageIndexForRound } from "@/lib/stage-rotation";
import type { MatchResponse } from "@/lib/types";

const stages = [3, 1, 2].map((n) => ({ id: n * 10, stage_number: n }));

describe("stage rotation", () => {
  it("round-robins from the squad's own stage", () => {
    expect(stageIndexForRound(1, 1, 3)).toBe(0);
    expect(stageIndexForRound(2, 1, 3)).toBe(1);
    expect(stageIndexForRound(3, 2, 3)).toBe(0);
  });
  it("orders a squad's rotation by stage number", () => {
    expect(squadRotation(2, stages).map((r) => r.stage.stage_number)).toEqual([2, 3, 1]);
    expect(squadRotation(2, stages).map((r) => r.round)).toEqual([1, 2, 3]);
  });
  it("is empty without stages", () => {
    expect(squadRotation(1, [])).toEqual([]);
  });
  it("finds the shooter's squad", () => {
    const match = {
      competitors: [{ id: 5, shooterId: 900 }, { id: 6, shooterId: null }],
      squads: [{ id: 1, number: 4, name: "Squad 4", competitorIds: [5, 6] }],
    } as unknown as MatchResponse;
    expect(squadForShooter(match, 900)?.number).toBe(4);
    expect(squadForShooter(match, 1)).toBeNull();
    expect(squadForShooter(match, null)).toBeNull();
  });
});
```

and append to `tests/unit/live-grid.test.ts`:

```ts
describe("buildEmptyGrid", () => {
  const match = {
    stages: [{ id: 11, stage_number: 1, name: "S1", max_points: 60 }],
    competitors: [
      { id: 5, shooterId: 900, name: "Anna Lind", competitor_number: "12", division: "Production" },
      { id: 6, shooterId: null, name: "Bo Ek", competitor_number: "13", division: null },
    ],
    squads: [{ id: 1, number: 4, name: "Squad 4", competitorIds: [5] }],
  } as unknown as MatchResponse;

  it("builds pending rows in the given order from match data only", () => {
    const g = buildEmptyGrid(match, [6, 5, 99]);
    expect(g.shooters.map((s) => s.id)).toEqual([6, 5]);
    expect(g.shooters[1]).toMatchObject({ name: "Anna Lind", competitor_number: "12", division: "Production", squad: "Squad 4", shooterId: 900 });
    expect(g.shooters[0].squad).toBeNull();
    expect(g.stages).toEqual([{ stage_id: 11, stage_num: 1, name: "S1", max_points: 60 }]);
    expect(g.cells).toEqual({ 6: {}, 5: {} });
  });
});
```

(add `buildEmptyGrid` and `MatchResponse` to that file's imports.)

Run: `pnpm -w exec vitest run tests/unit/stage-rotation.test.ts tests/unit/live-grid.test.ts` -- Expected: FAIL (missing exports).

- [ ] **Step 2: Implement** both modules as specified in Interfaces. In `components/pre-match-view.tsx`, replace the local `getStageIndex` and the `rotation` memo body with `squadRotation(selectedSquadNum, sortedStages)` (keep the memo and the null/empty guards). `lib/live-grid.ts` stays free of server imports (it is imported by the client).

- [ ] **Step 3: Verify and commit**

Run: `pnpm -w exec vitest run tests/unit/stage-rotation.test.ts tests/unit/live-grid.test.ts && pnpm -w run lint && pnpm -w run typecheck && pnpm -w test` -- Expected: PASS.

```bash
git add lib/stage-rotation.ts lib/live-grid.ts components/pre-match-view.tsx tests/unit/stage-rotation.test.ts tests/unit/live-grid.test.ts
git commit -m "refactor(grid): pure stage rotation and empty-grid builders"
```

---

### Task 2: Grid floor -- 12px text, 44px targets, 104px names, rail indicator, Manage

**Files:**
- Create: `components/live-grid-layout.ts`
- Modify: `components/live-grid.tsx`, `components/live-grid-cell.tsx`, `components/live-grid-sheet.tsx`, `app/match/[ct]/[id]/grid-page-client.tsx` (pass `onManage`)
- Test: `tests/components/live-grid.test.tsx`, `tests/unit/grid-text-floor.test.ts` (create), `tests/e2e/live-grid.spec.ts`

**Interfaces:**
- Produces:
  - `components/live-grid-layout.ts`: `export const NAME_COL = "w-[104px] min-w-[104px] max-w-[104px]"`, `export const SCROLL_PAD = "[scroll-padding-left:104px]"`, `export const CELL_MIN_W = "min-w-[74px]"` (with a comment: these three must agree; Tailwind needs literal class strings, so they live here as whole strings).
  - `LiveGridProps` gains `onManage?: () => void`.

- [ ] **Step 1: Failing text-floor scan** -- `tests/unit/grid-text-floor.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["components/live-grid.tsx", "components/live-grid-cell.tsx", "components/live-grid-sheet.tsx"];

describe("grid text floor", () => {
  it("no arbitrary text size below 12px in the courtside grid", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of readFileSync(f, "utf8").matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) < 12) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

Run -- Expected: FAIL listing the sub-12px sizes (8.5, 9, 9.5, 10, 11, 11.5).

- [ ] **Step 2: Apply the floor** -- every arbitrary text size below 12px in the three files becomes `text-[12px]`; values (hit factor, points) stay >= 14px as they are. Keep `tracking-*`, weight and color classes. In `live-grid-cell.tsx` check the cell still fits `CELL_MIN_W` at 390px (the e2e overflow test in Step 6 guards it); if "ALL A" plus the circle no longer fits, drop the letter-spacing class on that label rather than shrinking the text.

- [ ] **Step 3: Layout constants** -- create `components/live-grid-layout.ts`; in `live-grid.tsx` replace both name-column class fragments `w-[94px] min-w-[94px] max-w-[94px]` with `${NAME_COL}` (via `cn(...)`), the `[scroll-padding-left:94px]` with `SCROLL_PAD`, and `min-w-[74px]` with `CELL_MIN_W`. Update the scroll-padding comment and the `shortName` doc ("Fit a name into a 104px column").

- [ ] **Step 4: Rail as indicator + Live jump; Manage action** -- in `live-grid.tsx`:
  - The rail segments become non-interactive: wrap the segment row in `<div aria-hidden="true" className="flex flex-1 items-center gap-[3px]">` with plain `<span>`s (same state classes), and render the count as visible text `<span className="font-mono text-[12px] text-muted-foreground">{done}/{total}</span>` with an sr-only prefix "Stages done: ".
  - After the count, when `liveEdgeStageId != null`, a `<button type="button" onClick={() => jumpTo(liveEdgeStageId)} className="min-h-11 shrink-0 rounded-md border px-2.5 text-[12px] font-medium">Live: S{n}</button>` with `aria-label={`Jump to live stage ${n}`}`.
  - When `source === "tracked"` and `onManage` is set, a `min-h-11` "Manage" button right after the Tracked chip calling `onManage`. The source chips become `min-h-11` (drop `min-h-0`).
  - In `grid-page-client.tsx` pass `onManage={() => setShowManage(true)}` and render `<TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />` alongside the grid (it already exists for the empty state; reuse the same state).

- [ ] **Step 5: Component tests** -- in `tests/components/live-grid.test.tsx` replace rail-button tests with: the rail has no buttons named /jump to stage \d+$/; a "Live: S{n}" button exists when a live edge exists and calls `scrollTo`/sets `scrollLeft`; "Manage" renders only for the tracked source and calls `onManage`. Run -- Expected: FAIL before Step 4, PASS after.

- [ ] **Step 6: e2e** -- in `tests/e2e/live-grid.spec.ts`: replace "rail jump scrolls the grid" with "Live jump scrolls to the live stage" (click `getByRole("button", { name: /jump to live stage/i })`, expect `scrollLeft` > 0 when starting from 0 after a reset); in the snap test replace the "Jump to stage 5" step with the Live button; extend the 44px test to every button in `[data-live-grid-scroller]` AND the grid header row (source chips, Manage, Live) -- select them with a `data-live-grid-header` attribute you add to the header row; keep "does not overflow the page horizontally".

- [ ] **Step 7: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/live-grid.spec.ts tests/e2e/match-tabs.spec.ts --reporter=line` -- Expected: PASS.

```bash
git add components/live-grid-layout.ts components/live-grid.tsx components/live-grid-cell.tsx components/live-grid-sheet.tsx "app/match/[ct]/[id]/grid-page-client.tsx" tests
git commit -m "feat(grid): 12px text floor, 44px targets, live-stage jump and manage tracked"
```

---

### Task 3: Pre-match grid and strip

**Files:**
- Create: `components/pre-match-strip.tsx`, `tests/components/pre-match-strip.test.tsx`
- Modify: `components/live-grid.tsx` (`staticData` prop), `app/match/[ct]/[id]/grid-page-client.tsx`, `tests/e2e/match-tabs.spec.ts`

**Interfaces:**
- Consumes: `buildEmptyGrid`, `squadForShooter`, `squadRotation` (Task 1); `usePreMatchWeatherQuery(lat, lng, date, venue, region)` (`lib/queries.ts`); `saveLiveScoresOptIn`; `matchTabHref`.
- Produces:
  - `LiveGridProps.staticData?: LiveGridResponse` -- when set, `useLiveGridQuery` receives an empty id list (it self-disables) and the grid renders `staticData`; `computeLiveEdgeStageId` then yields null so no Live button shows.
  - `PreMatchStrip({ ct, id, match, myShooterId, onShowLiveScores })`.

- [ ] **Step 1: Failing component test** (`tests/components/pre-match-strip.test.tsx`): mock `@/lib/queries` `usePreMatchWeatherQuery` to return `{ data: { status: "ok", ... }, isLoading: false }` (read `WeatherCard`'s expected response shape in `components/pre-match-view.tsx` and mirror the minimum it reads: temperature and a weather code), render with a match whose squad 4 contains the identity's competitor and 3 stages. Assert: text "Squad 4"; "First stage: 1" derived from `squadRotation(4, stages)[0]` (compute the expected value in the test with the helper so the test does not hard-code rotation math); a temperature string; a "Show live scores" button calling `onShowLiveScores`; a link named "Match info" to `/match/22/1/info`. With `myShooterId` null: no squad line, the weather and button still render.

Run -- Expected: FAIL (module missing).

- [ ] **Step 2: Implement `components/pre-match-strip.tsx`** (`"use client"`): a `<section aria-labelledby="pre-match-strip-heading" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-2 text-[12px]">` with an sr-only `<h2 id="pre-match-strip-heading">Before scoring</h2>`, the squad and first-stage text when known, a compact weather line from `usePreMatchWeatherQuery` (same arguments as `PreMatchView`: `match.lat, match.lng, match.date?.slice(0,10) ?? null, match.venue, match.region`; render nothing for loading/unavailable), a `min-h-11` "Show live scores" button, and a `min-h-11` `Link` "Match info" (`prefetch={false}` -- the Info route shares the match layout, see PR 2 C1).

- [ ] **Step 3: `staticData` in LiveGrid** -- add the prop; `const query = useLiveGridQuery(ct, id, staticData ? EMPTY_IDS : shooters, { live });` and `const data = staticData ?? query.data;` (module-level `const EMPTY_IDS: number[] = []`). No other behaviour change. Add a component test: with `staticData`, `useLiveGridQuery` (mocked) is called with `[]` and the rows from `staticData` render.

- [ ] **Step 4: Grid page** -- in `grid-page-client.tsx` replace the pre-match "Scoring has not really started" block: when `phase === "prematch" && !optIn`, if `rows.length === 0` fall through to the existing "Pick your squad" state; otherwise render

```tsx
<div className="flex h-full flex-col">
  <PreMatchStrip ct={ct} id={id} match={match} myShooterId={identity?.shooterId ?? null} onShowLiveScores={() => saveLiveScoresOptIn(ct, id)} />
  <div className="min-h-0 flex-1">
    <LiveGrid ct={ct} id={id} shooters={rows} staticData={emptyGrid} myShooterId={identity?.shooterId ?? null} source={source} onSourceChange={onSourceChange} onManage={() => setShowManage(true)} />
  </div>
</div>
```

with `const emptyGrid = useMemo(() => buildEmptyGrid(match, rows), [match, rows]);` (declare the memo unconditionally above the early returns). The "live scores not public" state is unchanged and still takes precedence.

- [ ] **Step 5: e2e (RED first)** -- in `tests/e2e/match-tabs.spec.ts` replace the "pre-match grid never fetches live-grid until the user opts in" test body so it: counts `/api/live-grid` and `/api/compare` requests; seeds identity (as in `openGrid`); visits the grid with a match where `scoring_pct: 0` and `date` today; expects the `S1` column header and the "Show live scores" button to be visible; asserts both counters are 0 after 1s; clicks "Show live scores"; expects `/api/live-grid` count > 0 and `/api/compare` still 0. Add a test that tapping a pre-match cell opens the detail sheet showing "Not shot yet". Mock `/api/pre-match/weather` with `{}`-shaped "unavailable" JSON so no external call is attempted.

Run before Step 4 -- Expected: FAIL (no grid rendered pre-match). After -- PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`

```bash
git add components/pre-match-strip.tsx components/live-grid.tsx "app/match/[ct]/[id]/grid-page-client.tsx" tests
git commit -m "feat(grid): empty grid and pre-match strip before scoring, drawn without fetching"
```

---

### Task 4: Info order and top-bar warning dot

**Files:**
- Modify: `components/pre-match-view.tsx`, `app/match/[ct]/[id]/info/info-page-client.tsx`, `components/match-shell.tsx`
- Test: `tests/components/info-order.test.tsx` (create), `tests/components/match-shell.test.tsx` (create or extend), `tests/e2e/match-tabs.spec.ts`

**Interfaces:**
- Produces: `PreMatchView` section order squad -> stage rotation -> weather -> AI brief -> registered field; registered field wrapped in the CLAUDE.md accordion pattern, collapsed by default (`<h2><button aria-expanded aria-controls id="registered-field-heading">` + `<section role="region" aria-labelledby="registered-field-heading">`).

- [ ] **Step 1: Failing tests**
  - `tests/components/info-order.test.tsx`: render `PreMatchView` (mock `@/lib/queries` hooks: weather `{ data: undefined, isLoading: false }`, brief/dashboard idle) with a match that has squads, stages, competitors, lat/lng/date; collect `h2` texts in DOM order; assert the "Your squad" heading precedes the stage rotation heading, which precedes "Weather", which precedes the AI brief heading, which precedes the "Registered field" heading (use the actual heading texts from the file); assert the registered-field button has `aria-expanded="false"` and its region is not rendered/visible until clicked.
  - Info page order: in `tests/e2e/match-tabs.spec.ts`, extend the Info test: the match heading appears before the results disclaimer, which appears before "Your squad" (document order via `compareDocumentPosition`), and add the same checks for a completed match fixture (`match_status: "cp"`, `results_status: "all"`) where the disclaimer is absent and squad/rotation/weather/field still render.
  - `tests/components/match-shell.test.tsx`: TopBar (render `MatchShell` with `MatchGate`'s `useMatchQuery` mocked) shows an element with accessible name "Match notice" only when `match.match_status === "cs"` or `match.cacheInfo.upstreamDegraded || match.cacheInfo.upstreamPaused`; not for `results_status !== "all"` alone.

Run -- Expected: FAIL.

- [ ] **Step 2: Reorder `PreMatchView`** -- move the JSX blocks (they are delimited by the `{/* Your squad ... */}`, `{/* Stage rotation / list ... */}`, `{/* Weather forecast ... */}`, `{/* AI pre-match brief ... */}`, `{/* Registered field ... */}` comments) into the new order, unchanged inside; wrap the registered-field block in the accordion (local `useState(false)`). The two-column `md:grid-cols-2` grid stays.

- [ ] **Step 3: Info page order** -- in `info-page-client.tsx`: `MatchHeader` first, then the share row (`ShareEventLink`, `ShareButton`), then the upstream banner and the results/cancelled disclaimer, then `PreMatchView`, then the sheet.

- [ ] **Step 4: Warning dot** -- in `components/match-shell.tsx` `TopBar`: `const notice = match.match_status === "cs" || match.cacheInfo.upstreamDegraded === true || match.cacheInfo.upstreamPaused === true;` and when true render, before the percent, `<Link href={matchTabHref(ct, id, "info")} prefetch={false} aria-label="Match notice" className="grid h-11 w-11 place-items-center"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" /><span className="sr-only">Match notice, see Info</span></Link>` -- the dot is decoration; the accessible name carries the meaning (WCAG 1.4.1). Use a semantic token if one exists for warning (check `app/globals.css`), else `bg-amber-500` as the existing disclaimer does.

- [ ] **Step 5: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`

```bash
git add components/pre-match-view.tsx "app/match/[ct]/[id]/info/info-page-client.tsx" components/match-shell.tsx tests
git commit -m "feat(info): facts and notices first, squad and rotation next, field collapsed"
```

---

### Task 5: Open the PR

- [ ] Push `feat/grid-info-polish`; `gh pr create --base main --title "feat(grid): pre-match grid, 12px floor and info tab order" --body-file ~/.claude-tmp/pr4-body.md`. Body: **Why** (spec, PR 4 of 5, release held), **What**, **Decisions** (the three planning rulings above, the rail one prominently), **SSI upstream impact** (pre-match grid from loaded match data, zero SSI-backed requests before opt-in, e2e-proven; weather is Open-Meteo with shared cache key; no new polling/prefetch), **Tests**. End with the Claude Code attribution footer.
