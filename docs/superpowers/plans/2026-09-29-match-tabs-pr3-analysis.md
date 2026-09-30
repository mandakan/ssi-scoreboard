# Match Tabs PR 3 -- Analysis Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Analysis tab from one long scroll into four compact sections -- a one-row selection summary with a picker sheet, focus areas, the stage results table, one Charts card with a chart switcher, and a collapsed Deep dive -- and split the 1203-line `analysis-page-client.tsx` into focused components.

**Architecture:** `analysis-page-client.tsx` keeps state (selection, undo, compare query, stage sort) and composes three new presentational components under `components/analysis/`: `SelectionBar` (summary row + `Sheet` with the existing pickers), `ChartsCard` (chip switcher, one chart mounted, per-chart help popover), `DeepDive` (accordion with the coaching analyses, stage-time export, and the simulator when coaching). Pure helpers live in `lib/analysis-charts.ts` and `lib/selection-summary.ts`.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5, shadcn/ui (`sheet`, `collapsible`, `popover` already in `components/ui/`), Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md` Section 3 ("Order", "Live vs complete", "Popovers", telemetry `chart-switch` and `analysis-section-open`). Predecessors: PR 1 (#561, `trackUi`), PR 2 (#563, routes and shell).

## Global Constraints

- HARD (user): no change may increase calls to the SSI upstream API. Specifically:
  - The only new request this PR may add is ONE `mode=coaching` compare request when the user opens Deep dive during a live match (no polling: `useCompareQuery` with mode "coaching" has `refetchInterval: false`, `refetchOnWindowFocus: false`). The compare route's upstream path (match + scorecards snapshot) is identical in both modes and is already being polled by the live Analysis tab; coaching mode only adds in-process computation and a Redis read (`app/api/compare/route.ts:249`, `:464`, `:532`).
  - The Stage Simulator stays coaching-only (as today): `/api/simulate` does a cached GetMatch read that can refresh upstream, so it must not become reachable in live mode.
  - No new prefetch, polling or refetch-on-focus anywhere.
- Mobile-first 390px, no horizontal overflow, 44px touch targets, `role="alert"` on errors (CLAUDE.md).
- Every chart keeps an info popover explaining axes / reading / tips; the popover must follow the selected chart (CLAUDE.md "Chart info popovers").
- Accordion pattern: `<hN><button aria-expanded aria-controls>` with `<section role="region" aria-labelledby>`; unique region labels (CLAUDE.md).
- Help popovers: `max-w-[calc(100vw-2rem)]` in addition to `w-80` (spec Section 3).
- Per-viewer UI conveniences (last chart) use `localStorage` wrapped in try/catch and read hydration-safely (`useSyncExternalStore`, stable server snapshot).
- Telemetry via `trackUi` only: `chart-switch` with the enum ids in `lib/ui-telemetry-schema.ts` (`hf-by-stage`, `hf-pct`, `division-position`, `speed-accuracy`, `stage-balance`); `analysis-section-open` with `charts` and `deep-dive` (and existing `simulator`).
- ASCII punctuation in new comments and UI copy (no literal "--" in UI text). Copied existing copy may keep its characters.
- `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test` clean before each commit; e2e with `SSI_UPSTREAM_PAUSED=on`. Known unrelated failure on `main`: e2e "My Shooters drawer closes on overlay click".
- PR title: `feat(analysis): selection sheet, chart switcher and deep dive`. Release stays held until PR 5.

## Review Focus

- Opening Deep dive during a live match fires exactly one coaching compare request and never re-polls; closing and reopening it does not refire within the query's staleTime. Test in Task 3.
- Deep dive in live mode never renders the simulator. Test in Task 3.
- A chart id stored in localStorage that is not available for this match (e.g. `division-position` without distribution data) falls back to the first available chart instead of rendering nothing. Test in Task 2.
- With zero competitors selected, the selection bar still offers the picker (the sheet opens) and the page shows the "Select one or more" hint -- no dead end. Test in Task 4.
- At 390px the chip row scrolls horizontally inside the card without causing page overflow. Test in Task 5 (e2e overflow check).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/analysis-charts.ts` (create) | Pure: `ANALYSIS_CHARTS` metadata, `availableCharts(data)`, `resolveChart(stored, available)`. |
| `lib/selection-summary.ts` (create) | Pure: `selectionSummary(names, maxNames)` -> "Anna L., Erik S. +1". |
| `components/analysis/chart-help.tsx` (create) | The five chart help popover bodies, moved verbatim, keyed by chart id. |
| `components/analysis/charts-card.tsx` (create) | Chip switcher, one chart mounted, help popover for the selected chart, telemetry, persisted choice. |
| `components/analysis/deep-dive.tsx` (create) | Collapsed Deep dive; coaching content + export; live-mode one-shot coaching fetch; simulator when coaching. |
| `components/analysis/selection-bar.tsx` (create) | Summary row + `Sheet` containing the existing picker row, help popover, Clear, Reset to grid shooters. |
| `app/match/[ct]/[id]/analysis/analysis-page-client.tsx` (modify) | Compose the above; delete the moved JSX. |
| `components/*` popovers (modify) | `max-w-[calc(100vw-2rem)]`. |
| `scripts/screenshot-match.ts`, `tests/e2e/*.spec.ts` (modify) | New structure. |

Branch: `git checkout main && git pull && git checkout -b feat/analysis-restructure` (commit this plan first).

---

### Task 1: Popover widths

**Files:**
- Modify: every file with `PopoverContent className="w-80"`: `app/match/[ct]/[id]/analysis/analysis-page-client.tsx`, `components/anchor-stage-card.tsx`, `components/stage-times-export.tsx`, `components/archetype-performance.tsx`, `components/course-performance.tsx`, `components/focus-areas-section.tsx` (re-grep to be sure: `grep -rln 'PopoverContent className="w-80' app components`).
- Test: `tests/unit/popover-widths.test.ts` (create)

**Interfaces:** Produces nothing consumed later; later tasks that move popovers keep the new class string.

- [ ] **Step 1: Failing test** -- a source scan so a future popover cannot regress:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("help popover widths", () => {
  it("every w-80 PopoverContent is capped to the viewport", () => {
    const offenders: string[] = [];
    for (const file of [...walk("app"), ...walk("components")]) {
      if (file.includes(`components${"/"}ui${"/"}`)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<PopoverContent[^>]*className="([^"]*)"/g)) {
        const cls = m[1];
        if (/\bw-80\b/.test(cls) && !cls.includes("max-w-[calc(100vw-2rem)]")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

Run: `pnpm -w exec vitest run tests/unit/popover-widths.test.ts` -- Expected: FAIL listing the files above.

- [ ] **Step 2: Implement** -- replace `className="w-80"` on `PopoverContent` with `className="w-80 max-w-[calc(100vw-2rem)]"` in every listed file (keep any other classes already present).

- [ ] **Step 3: Verify and commit**

Run: `pnpm -w exec vitest run tests/unit/popover-widths.test.ts && pnpm -w run lint && pnpm -w run typecheck` -- Expected: PASS.

```bash
git add -A app components tests/unit/popover-widths.test.ts
git commit -m "fix(ui): cap help popovers to the viewport width"
```

---

### Task 2: Charts card with a chart switcher

**Files:**
- Create: `lib/analysis-charts.ts`, `components/analysis/chart-help.tsx`, `components/analysis/charts-card.tsx`
- Modify: `app/match/[ct]/[id]/analysis/analysis-page-client.tsx` (replace the five chart `<div className="rounded-lg border p-4 space-y-3">` blocks, currently from `Hit factor by stage` through `Stage balance`, with one `<ChartsCard .../>`)
- Test: `tests/unit/analysis-charts.test.ts`, `tests/components/charts-card.test.tsx`

**Interfaces:**
- Consumes: `CHART_IDS` / `UiTelemetryEvent` from `lib/ui-telemetry-schema.ts`; `trackUi`; `CompareResponse`, `StageComparison` types.
- Produces:
  - `type AnalysisChartId = (typeof CHART_IDS)[number]`
  - `ANALYSIS_CHARTS: { id: AnalysisChartId; label: string; title: string }[]` in order `hf-by-stage` ("HF by stage" / "Hit factor by stage"), `hf-pct` ("HF %" / "HF% vs stage winner"), `division-position` ("Division" / "Division position"), `speed-accuracy` ("Speed/accuracy" / "Speed vs. accuracy"), `stage-balance` ("Balance" / "Stage balance")
  - `availableCharts(data: CompareResponse): AnalysisChartId[]` -- all except `division-position` when no stage has `divisionDistributions` entries
  - `resolveChart(stored: string | null, available: AnalysisChartId[]): AnalysisChartId` -- stored if available, else `available[0]`
  - `CHART_STORAGE_KEY = "ssi-analysis-chart"`
  - `ChartsCard(props: { data: CompareResponse; stages: StageComparison[]; sortedCompName: string | null; careerBaselineHF: number | null | undefined; careerBaselinePct: number | null | undefined; ct: string })`

- [ ] **Step 1: Failing unit tests** (`tests/unit/analysis-charts.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { ANALYSIS_CHARTS, availableCharts, resolveChart } from "@/lib/analysis-charts";
import { CHART_IDS } from "@/lib/ui-telemetry-schema";
import type { CompareResponse } from "@/lib/types";

const withDist = { stages: [{ divisionDistributions: { Production: {} } }] } as unknown as CompareResponse;
const noDist = { stages: [{ divisionDistributions: {} }, {}] } as unknown as CompareResponse;

describe("analysis charts", () => {
  it("covers exactly the telemetry chart ids, in order", () => {
    expect(ANALYSIS_CHARTS.map((c) => c.id)).toEqual([...CHART_IDS]);
  });
  it("offers division position only with distribution data", () => {
    expect(availableCharts(withDist)).toContain("division-position");
    expect(availableCharts(noDist)).not.toContain("division-position");
    expect(availableCharts(noDist)).toHaveLength(4);
  });
  it("resolves a stored choice when available", () => {
    expect(resolveChart("stage-balance", availableCharts(noDist))).toBe("stage-balance");
  });
  it("falls back to the first chart for missing, unknown or unavailable ids", () => {
    const av = availableCharts(noDist);
    expect(resolveChart(null, av)).toBe("hf-by-stage");
    expect(resolveChart("pie", av)).toBe("hf-by-stage");
    expect(resolveChart("division-position", av)).toBe("hf-by-stage");
  });
});
```

Run: `pnpm -w exec vitest run tests/unit/analysis-charts.test.ts` -- Expected: FAIL (module missing).

- [ ] **Step 2: Implement `lib/analysis-charts.ts`**

```ts
// Chart catalogue for the Analysis tab's Charts card. Ids double as the
// telemetry enum (lib/ui-telemetry-schema.ts CHART_IDS), so the order and
// spelling must match -- a unit test pins it.

import type { CHART_IDS } from "@/lib/ui-telemetry-schema";
import type { CompareResponse } from "@/lib/types";

export type AnalysisChartId = (typeof CHART_IDS)[number];

export const CHART_STORAGE_KEY = "ssi-analysis-chart";

export const ANALYSIS_CHARTS: { id: AnalysisChartId; label: string; title: string }[] = [
  { id: "hf-by-stage", label: "HF by stage", title: "Hit factor by stage" },
  { id: "hf-pct", label: "HF %", title: "HF% vs stage winner" },
  { id: "division-position", label: "Division", title: "Division position" },
  { id: "speed-accuracy", label: "Speed/accuracy", title: "Speed vs. accuracy" },
  { id: "stage-balance", label: "Balance", title: "Stage balance" },
];

export function availableCharts(data: CompareResponse): AnalysisChartId[] {
  const hasDist = data.stages.some(
    (s) => Object.keys(s.divisionDistributions ?? {}).length > 0,
  );
  return ANALYSIS_CHARTS.map((c) => c.id).filter(
    (id) => id !== "division-position" || hasDist,
  );
}

export function resolveChart(
  stored: string | null,
  available: AnalysisChartId[],
): AnalysisChartId {
  return available.find((id) => id === stored) ?? available[0];
}
```

(`import type { CHART_IDS }` is a type-only import of a value's type via `typeof` -- if TypeScript rejects it, import it as a value: `import { CHART_IDS } from ...` and `export type AnalysisChartId = (typeof CHART_IDS)[number];`.)

Run the unit test -- Expected: PASS.

- [ ] **Step 3: Move the help bodies** -- create `components/analysis/chart-help.tsx` exporting `CHART_HELP: Record<AnalysisChartId, { description: React.ReactNode; body: React.ReactNode }>`. For each chart, `description` is the `<PopoverDescription>` text and `body` the `<div className="text-xs text-muted-foreground space-y-1.5 mt-2">` children, copied verbatim from the five chart blocks in `analysis-page-client.tsx` (they use `ArrowUpDown` -- import it from `lucide-react`). Add one sentence to each body: "Use the chips above the chart to switch views; your last choice is remembered on this device." (ASCII).

- [ ] **Step 4: Failing component tests** (`tests/components/charts-card.test.tsx`) -- mock `next/dynamic` is not needed; mock the chart modules so each renders a marker:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CompareResponse } from "@/lib/types";

vi.mock("@/components/comparison-chart", () => ({ ComparisonChart: () => <p>chart:hf-by-stage</p> }));
vi.mock("@/components/hf-percent-chart", () => ({ HfPercentChart: () => <p>chart:hf-pct</p> }));
vi.mock("@/components/division-distribution-chart", () => ({ DivisionDistributionChart: () => <p>chart:division-position</p> }));
vi.mock("@/components/scatter-chart", () => ({ SpeedAccuracyChart: () => <p>chart:speed-accuracy</p> }));
vi.mock("@/components/radar-chart", () => ({ StageBalanceChart: () => <p>chart:stage-balance</p> }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));

import { ChartsCard } from "@/components/analysis/charts-card";

const data = { stages: [{ divisionDistributions: {} }] } as unknown as CompareResponse;
const props = { data, stages: [], sortedCompName: null, careerBaselineHF: null, careerBaselinePct: null, ct: "22" };

describe("ChartsCard", () => {
  beforeEach(() => { localStorage.clear(); trackUi.mockClear(); });

  it("mounts only the first available chart by default", async () => {
    render(<ChartsCard {...props} />);
    expect(await screen.findByText("chart:hf-by-stage")).toBeInTheDocument();
    expect(screen.queryByText("chart:hf-pct")).toBeNull();
    expect(screen.queryByRole("button", { name: "Division" })).toBeNull();
  });

  it("switches chart, remembers it, and reports the switch", async () => {
    render(<ChartsCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Balance" }));
    expect(await screen.findByText("chart:stage-balance")).toBeInTheDocument();
    expect(screen.queryByText("chart:hf-by-stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Balance" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("ssi-analysis-chart")).toBe("stage-balance");
    expect(trackUi).toHaveBeenCalledWith({ op: "chart-switch", ct: 22, chart: "stage-balance" });
  });

  it("restores a stored choice and falls back when unavailable", async () => {
    localStorage.setItem("ssi-analysis-chart", "division-position");
    render(<ChartsCard {...props} />);
    expect(await screen.findByText("chart:hf-by-stage")).toBeInTheDocument();
  });

  it("titles the card and its help button after the selected chart", async () => {
    render(<ChartsCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "HF %" }));
    expect(await screen.findByRole("heading", { name: /HF% vs stage winner/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About HF% vs stage winner" })).toBeInTheDocument();
  });
});
```

Run: `pnpm -w exec vitest run tests/components/charts-card.test.tsx` -- Expected: FAIL (module missing).

- [ ] **Step 5: Implement `components/analysis/charts-card.tsx`** (`"use client"`):
  - Dynamic imports for the five charts exactly as `analysis-page-client.tsx` declares them today (move those five `dynamic(...)` declarations here; delete them from the page).
  - Selected chart: `stored = useSyncExternalStore(noopSubscribe, () => safeGet(CHART_STORAGE_KEY), () => null)`; local override `useState<AnalysisChartId | null>(null)`; `selected = resolveChart(override ?? stored, availableCharts(data))`. `safeGet`/`safeSet` wrap `localStorage` in try/catch.
  - Chip row: `<div role="group" aria-label="Chart" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">` of `<button type="button" aria-pressed className="min-h-11 shrink-0 rounded-full border px-3 text-sm ...">{label}</button>` for each available chart; selected chip uses `border-foreground bg-foreground text-background`.
  - On chip click: set override, `safeSet(CHART_STORAGE_KEY, id)`, `trackUi({ op: "chart-switch", ct: parseInt(ct, 10), chart: id })`.
  - Header: `<h2 className="font-semibold">{title}{sortedCompName && ... shooting order span, copied from today's blocks, only for hf-by-stage / hf-pct / division-position}</h2>` + help `Popover` whose trigger has `aria-label={`About ${title}`}` and whose content is `<PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">` with `PopoverHeader/PopoverTitle/PopoverDescription` from `CHART_HELP[selected]`.
  - Body: render only the selected chart with the same props today's blocks pass (`ComparisonChart data stages careerBaselineHF`, `HfPercentChart data stages careerBaselinePct`, `DivisionDistributionChart data stages`, `SpeedAccuracyChart data`, `StageBalanceChart data`).
  - Section-open telemetry: a ref on the card root and an effect with `IntersectionObserver` (skip when `typeof IntersectionObserver === "undefined"`) that calls `trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "charts" })` once, the first time the card is at least 50% visible, then disconnects.
  - Root: `<section aria-labelledby="charts-card-heading" className="rounded-lg border p-4 space-y-3">`, `id="charts-card-heading"` on the h2.

Run the component test -- Expected: PASS.

- [ ] **Step 6: Wire into the page** -- in `analysis-page-client.tsx` replace the five chart blocks with:

```tsx
<ChartsCard
  data={compareQuery.data}
  stages={sortedStages}
  sortedCompName={sortedCompName}
  careerBaselineHF={myCompetitorId != null ? careerBaseline?.medianHF : null}
  careerBaselinePct={myCompetitorId != null ? careerBaseline?.medianMatchPct : null}
  ct={ct}
/>
```

Remove now-unused imports. The `id="chart-speed-accuracy"` anchor is dropped (check `grep -rn "chart-speed-accuracy" app components scripts tests` and update any user).

- [ ] **Step 7: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/scoreboard.spec.ts --reporter=line`
Expected: all pass (the scoreboard test "chart renders as SVG after competitor selection" still finds an SVG because the default chart renders).

```bash
git add lib/analysis-charts.ts components/analysis tests/unit/analysis-charts.test.ts tests/components/charts-card.test.tsx "app/match/[ct]/[id]/analysis/analysis-page-client.tsx"
git commit -m "feat(analysis): one charts card with a chart switcher"
```

---

### Task 3: Deep dive

**Files:**
- Create: `components/analysis/deep-dive.tsx`
- Modify: `app/match/[ct]/[id]/analysis/analysis-page-client.tsx` (replace the `{compareMode === "coaching" && (<> Coaching Collapsible ... Simulator Collapsible </>)}` block with `<DeepDive .../>`; move `showCoachingView`/`showSimulator` state and the two open-change callbacks into DeepDive)
- Modify: `tests/e2e/drawer-collapsible-toggle.spec.ts` (coaching/simulator tests)
- Test: `tests/components/deep-dive.test.tsx`

**Interfaces:**
- Consumes: `useCompareQuery(ct, id, ids, mode)` (`lib/queries.ts`; mode "coaching" = no polling, no focus refetch, 300s staleTime, disabled on empty ids); `trackUi`; `StageTimesExport`; the coaching components.
- Produces: `DeepDive(props: { ct: string; id: string; match: MatchResponse; selectedIds: number[]; compareMode: CompareMode; coachingData: CompareResponse | undefined })` -- `coachingData` is the page's compare data when `compareMode === "coaching"`, else `undefined`.

- [ ] **Step 1: Failing component tests** (`tests/components/deep-dive.test.tsx`):

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CompareResponse, MatchResponse } from "@/lib/types";

const useCompareQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useCompareQuery: (...a: unknown[]) => useCompareQuery(...a) }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));
vi.mock("@/components/course-performance", () => ({ CourseLengthSummary: () => <p>course</p>, ConstraintSummary: () => <p>constraints</p> }));
vi.mock("@/components/archetype-performance", () => ({ ArchetypePerformanceSummary: () => <p>archetypes</p> }));
vi.mock("@/components/style-fingerprint-chart", () => ({ StyleFingerprintChart: () => <p>fingerprint</p> }));
vi.mock("@/components/shooter-style-radar-chart", () => ({ ShooterStyleRadarChart: () => <p>style</p> }));
vi.mock("@/components/stage-degradation-chart", () => ({ StageDegradationChart: () => <p>degradation</p> }));
vi.mock("@/components/stage-simulator", () => ({ StageSimulator: () => <p>simulator</p> }));
vi.mock("@/components/stage-times-export", () => ({ StageTimesExport: () => <p>export</p> }));

import { DeepDive } from "@/components/analysis/deep-dive";

const match = { scoring_pct: 90, competitors: [] } as unknown as MatchResponse;
const coaching = { competitors: [] } as unknown as CompareResponse;

describe("DeepDive", () => {
  beforeEach(() => {
    useCompareQuery.mockReset().mockReturnValue({ data: undefined, isLoading: false, isError: false });
    trackUi.mockClear();
  });

  it("is collapsed by default and fetches nothing while live and closed", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1, 2]} compareMode="live" coachingData={undefined} />);
    expect(screen.getByRole("button", { name: /deep dive/i })).toHaveAttribute("aria-expanded", "false");
    for (const call of useCompareQuery.mock.calls) expect(call[2]).toEqual([]);
  });

  it("while live, opening fires one coaching-mode query and reports the open", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1, 2]} compareMode="live" coachingData={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    const last = useCompareQuery.mock.calls.at(-1)!;
    expect(last).toEqual(["22", "1", [1, 2], "coaching"]);
    expect(trackUi).toHaveBeenCalledWith({ op: "analysis-section-open", ct: 22, section: "deep-dive" });
  });

  it("while live, never renders the simulator", () => {
    useCompareQuery.mockReturnValue({ data: coaching, isLoading: false, isError: false });
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="live" coachingData={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    expect(screen.getByText("export")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stage simulator/i })).toBeNull();
  });

  it("when coaching, reuses the page data (no extra query) and offers the simulator at >=80%", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="coaching" coachingData={coaching} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    for (const call of useCompareQuery.mock.calls) expect(call[2]).toEqual([]);
    expect(screen.getByText("fingerprint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stage simulator/i })).toBeInTheDocument();
  });
});
```

Run: `pnpm -w exec vitest run tests/components/deep-dive.test.tsx` -- Expected: FAIL (module missing).

- [ ] **Step 2: Implement `components/analysis/deep-dive.tsx`** (`"use client"`):
  - Move from the page: the dynamic imports for `StyleFingerprintChart`, `ArchetypePerformanceSummary`, `CourseLengthSummary`, `ConstraintSummary`, `ShooterStyleRadarChart`, `StageDegradationChart`, `StageSimulator`; the `showCoachingView` / `showSimulator` state and both `on...OpenChange` callbacks (rename `showCoachingView` -> `open`); the coaching `Collapsible` and the simulator `Collapsible` JSX, verbatim except:
    - heading button text: "Deep dive" with subtitle "Course length, constraints, archetypes, style and stage-order effects, plus stage-time export." (replaces "Coaching analysis" / "Post-match aggregate view -- not recommended during active shooting." -- write the subtitle without "--"); keep `id="coaching-view-heading"` renamed to `id="deep-dive-heading"` and `Collapsible id="deep-dive"`;
    - the simulator `Collapsible` moves INSIDE the Deep dive `<section role="region">`, after `StageTimesExport`, rendered only when `compareMode === "coaching" && match.scoring_pct >= 80`;
    - all `PopoverContent` keep `className="w-80 max-w-[calc(100vw-2rem)]"`.
  - Data:

```tsx
  // Live matches: fetch coaching data once, only after the user opens the
  // section. mode "coaching" never polls (lib/queries.ts), and the compare
  // route's upstream path is identical in both modes, so this adds no SSI
  // traffic beyond the live poll already running on this tab.
  const oneShot = useCompareQuery(
    ct,
    id,
    compareMode === "live" && open ? selectedIds : EMPTY_IDS,
    "coaching",
  );
  const data = compareMode === "coaching" ? coachingData : oneShot.data;
```

    Inside the region: if `!data && oneShot.isLoading` render a `Skeleton` block; if `oneShot.isError` render `role="alert"` "Could not load the deep dive." with a Retry button calling `oneShot.refetch()`; else render the moved content with `data`.
  - `EMPTY_IDS` is a module-level `const EMPTY_IDS: number[] = []`.

Run the component test -- Expected: PASS.

- [ ] **Step 3: Wire into the page** -- replace the coaching block with:

```tsx
<DeepDive
  ct={ct}
  id={id}
  match={match}
  selectedIds={selectedIds}
  compareMode={compareMode}
  coachingData={compareMode === "coaching" ? compareQuery.data : undefined}
/>
```

rendered for both modes (it sits inside the existing `compareQuery.data && !compareQuery.data.scorecardsRestricted` branch). Delete the moved state, callbacks, dynamic imports and JSX from the page.

- [ ] **Step 4: Update e2e** -- in `tests/e2e/drawer-collapsible-toggle.spec.ts`: the coaching toggle is now `getByRole("button", { name: /deep dive/i })`, its region is `[aria-labelledby='deep-dive-heading']`, and the simulator button is only visible after opening Deep dive (open it first, then assert `aria-expanded="false"` on the simulator button). The telemetry assertion keeps `section: "deep-dive"`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/drawer-collapsible-toggle.spec.ts tests/e2e/scoreboard.spec.ts --reporter=line`
Expected: pass (known flake aside).

```bash
git add components/analysis/deep-dive.tsx tests/components/deep-dive.test.tsx "app/match/[ct]/[id]/analysis/analysis-page-client.tsx" tests/e2e/drawer-collapsible-toggle.spec.ts
git commit -m "feat(analysis): collapsed deep dive with coaching analyses and export"
```

---

### Task 4: Selection bar and picker sheet

**Files:**
- Create: `lib/selection-summary.ts`, `components/analysis/selection-bar.tsx`
- Modify: `app/match/[ct]/[id]/analysis/analysis-page-client.tsx` (replace the `{/* Competitor picker */}` block, keeping the undo toast rendered by the page below the bar)
- Modify: `tests/e2e/scoreboard.spec.ts` and any e2e that clicks "Add competitor" / "Squad" / "Clear" on Analysis (open the sheet first)
- Test: `tests/unit/selection-summary.test.ts`, `tests/components/selection-bar.test.tsx`

**Interfaces:**
- Produces:
  - `selectionSummary(names: string[], maxNames = 2): string` -- shortens each name like the grid ("Mathias Axell" -> "Mathias A."; "A. Lindstrom" stays), joins the first `maxNames` with ", ", appends ` +N` for the rest; `""` for none.
  - `SelectionBar(props: { match: MatchResponse; selectedIds: number[]; gridRows: number[]; identityShooterId: number | null; trackedIds: Set<number>; fieldFingerprintPoints: FieldFingerprintPoint[]; benchmarkDisabled: boolean; trackedInMatch: { present: number; total: number } | null; onSelectionChange: (ids: number[]) => void; onReplaceSelection: (ids: number[], message: string) => void; onSetMyIdentity: (c: { shooterId: number | null; name: string }) => void; onToggleTracked: (c: { shooterId: number | null; name: string; club: string | null; division: string | null }) => void; onManage: () => void })`
- Move `shortName()` out of `components/live-grid.tsx` into `lib/selection-summary.ts` as `export function shortName(full: string): string` (unchanged body and doc comment) and import it back into `live-grid.tsx`.

- [ ] **Step 1: Failing unit test**

```ts
import { describe, expect, it } from "vitest";
import { selectionSummary, shortName } from "@/lib/selection-summary";

describe("selectionSummary", () => {
  it("is empty for no names", () => expect(selectionSummary([])).toBe(""));
  it("shortens and joins up to two", () => {
    expect(selectionSummary(["Anna Lind", "Erik Svensson"])).toBe("Anna L., Erik S.");
  });
  it("counts the rest", () => {
    expect(selectionSummary(["Anna Lind", "Erik Svensson", "Bo Ek", "Al Bo"])).toBe("Anna L., Erik S. +2");
  });
  it("keeps initial-first names readable", () => {
    expect(shortName("A. Lindstrom")).toBe("A. Lindstrom");
  });
});
```

Run -- Expected: FAIL (module missing).

- [ ] **Step 2: Implement `lib/selection-summary.ts`** with `shortName` moved verbatim from `components/live-grid.tsx` and:

```ts
export function selectionSummary(names: string[], maxNames = 2): string {
  if (names.length === 0) return "";
  const head = names.slice(0, maxNames).map(shortName).join(", ");
  const rest = names.length - maxNames;
  return rest > 0 ? `${head} +${rest}` : head;
}
```

Update `live-grid.tsx` to import `shortName`. Run the unit test and `tests/components/live-grid.test.tsx` -- Expected: PASS.

- [ ] **Step 3: Failing component test** (`tests/components/selection-bar.test.tsx`): render `SelectionBar` with a two-competitor match (`competitors: [{id: 1, name: "Anna Lind", ...}, {id: 2, name: "Erik Svensson", ...}]`, `squads: []`), `selectedIds=[1, 2]`, `gridRows=[2]`, spies for callbacks. Assert:
  - the summary button's accessible name matches `/Comparing: Anna L., Erik S./` and has `aria-haspopup="dialog"`;
  - clicking it opens a dialog (`getByRole("dialog", { name: "Who to compare" })`) containing the "Add competitor" button and "Clear" button;
  - clicking "Reset to grid shooters" calls `onReplaceSelection([2], "Reset to grid shooters")`;
  - with `selectedIds=[]` the summary reads "Choose shooters to compare" and the dialog still opens with the picker;
  - with `gridRows=[]` there is no "Reset to grid shooters" button.
  Mock `@/components/competitor-picker`, `@/components/squad-picker`, `@/components/benchmark-picker` as simple buttons ("Add competitor", "Squad", "Benchmark") to keep the test focused.

Run -- Expected: FAIL.

- [ ] **Step 4: Implement `components/analysis/selection-bar.tsx`** (`"use client"`) using `Sheet`, `SheetContent side="bottom"`, `SheetHeader`, `SheetTitle` ("Who to compare"), `SheetDescription` (copy of the current help popover's description line) from `@/components/ui/sheet`:
  - Row: `<button type="button" aria-haspopup="dialog" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm">` showing `Comparing: {selectionSummary(names)}` or "Choose shooters to compare", plus a `ChevronDown` icon (`aria-hidden`), and `trackedInMatch` text ("{present} of {total} tracked") as a secondary line when present.
  - Sheet body: the existing picker row JSX moved verbatim from the page (`CompetitorPicker`, `SquadPicker`, `BenchmarkPicker`, Clear button) wired to the props, the existing "Picking who to compare" help popover moved verbatim (width class per Task 1), and when `gridRows.length > 0` a `Button variant="outline" className="min-h-11"` "Reset to grid shooters" calling `onReplaceSelection(gridRows.slice(0, MAX_COMPETITORS), "Reset to grid shooters")`.
  - The sheet content scrolls (`max-h-[85dvh] overflow-y-auto`) and pads for the safe area (`pb-[max(1rem,env(safe-area-inset-bottom))]`).

Run the component test -- Expected: PASS.

- [ ] **Step 5: Wire into the page** -- replace the competitor-picker block with `<SelectionBar .../>` passing the page's existing handlers (`handleSelectionChange`, `replaceSelectionWithUndo`, `handleSetMyIdentity`, `handleToggleTracked`, `() => setShowManage(true)`), `gridRows` (already computed in the page), `fieldFingerprintPoints={compareQuery.data?.fieldFingerprintPoints ?? []}`, `benchmarkDisabled={!compareQuery.data}`. Keep the `pendingUndo` status toast in the page directly below the bar. Update the "Select one or more" hint copy to "Choose shooters above to see the comparison."

- [ ] **Step 6: Update e2e** -- add a helper in `tests/e2e/scoreboard.spec.ts`:

```ts
async function openPicker(page: Page) {
  await page.getByRole("button", { name: /comparing:|choose shooters/i }).click();
  await expect(page.getByRole("dialog", { name: "Who to compare" })).toBeVisible();
}
```

and call it before every interaction with "Add competitor", "Squad" or "Clear" on `/analysis` (tests that select competitors, deselect, squad replace; the "analysis with no selection" test now asserts the "Choose shooters to compare" summary instead of the "Add competitor" button). Close the sheet (`page.keyboard.press("Escape")`) before asserting table content.

- [ ] **Step 7: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`
Expected: all pass (known flake aside).

```bash
git add lib/selection-summary.ts components/analysis/selection-bar.tsx components/live-grid.tsx tests "app/match/[ct]/[id]/analysis/analysis-page-client.tsx"
git commit -m "feat(analysis): one-row selection summary with a picker sheet"
```

---

### Task 5: Page order, overflow, screenshots

**Files:**
- Modify: `app/match/[ct]/[id]/analysis/analysis-page-client.tsx`, `scripts/screenshot-match.ts`, `tests/e2e/match-tabs.spec.ts`

- [ ] **Step 1: Failing e2e** -- in `tests/e2e/match-tabs.spec.ts` add (reuse its fixtures; the analysis route needs `/api/compare` mocked -- copy `MOCK_COMPARE` shape from `tests/e2e/drawer-collapsible-toggle.spec.ts` adapted to competitors 100/101):

```ts
test("analysis sections appear in spec order without horizontal overflow", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.route(/\/api\/compare/, (r) => r.fulfill({ json: MOCK_COMPARE }));
  await page.goto("/match/22/88888888/analysis?competitors=100,101");
  const order = await page.locator("main h2").allTextContents();
  const idx = (re: RegExp) => order.findIndex((t) => re.test(t));
  expect(idx(/Stage results/)).toBeGreaterThanOrEqual(0);
  expect(idx(/Stage results/)).toBeLessThan(idx(/Hit factor by stage/));
  expect(idx(/Hit factor by stage/)).toBeLessThan(idx(/Deep dive/));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
```

Run -- Expected: PASS or FAIL depending on the current order; if it passes already, keep it as the regression guard and note that in the report.

- [ ] **Step 2: Order** -- ensure the page renders, top to bottom: loading bar, cache badge + share row, upstream banner, `SelectionBar`, undo toast, "Match in progress" / pre-match gate, then inside the comparison branch: live notice, skeleton / error / restricted states, `FocusAreasSection`, Stage results table, `ChartsCard`, `DeepDive`; then the hint and `TrackedShootersSheet`. Remove dead imports; the file should be well under 700 lines (report the count).

- [ ] **Step 3: Screenshots** -- in `scripts/screenshot-match.ts`, scenes that scroll to coaching headings (`Stage degradation`, `Stage archetype breakdown`, `Shooter style fingerprint`, `Export stage times`) first click `page.getByRole("button", { name: /deep dive/i })` and wait for the region; scenes that target the HF-by-stage or HF% charts click the chip (`getByRole("button", { name: "HF %" })`) before scrolling. Type-check only (`pnpm -w run typecheck`); PR 5 regenerates images.

- [ ] **Step 4: Verify and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`

```bash
git add "app/match/[ct]/[id]/analysis/analysis-page-client.tsx" scripts/screenshot-match.ts tests/e2e/match-tabs.spec.ts
git commit -m "feat(analysis): spec section order; screenshot scenes follow the new structure"
```

---

### Task 6: Open the PR

- [ ] Push `feat/analysis-restructure`; `gh pr create --base main --title "feat(analysis): selection sheet, chart switcher and deep dive" --body-file ~/.claude-tmp/pr3-body.md`. Body: **Why** (spec link, PR 3 of 5, release held until PR 5), **What** (selection sheet, charts card, deep dive, popover widths, file split with line counts), **SSI upstream impact** (the one-shot coaching request on Deep dive open during live and why it adds no upstream traffic; simulator stays coaching-only; no new polling/prefetch), **Tests**. End with the Claude Code attribution footer.
