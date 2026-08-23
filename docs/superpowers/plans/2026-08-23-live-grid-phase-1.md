# Courtside Grid (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full-screen, one-row-per-shooter, one-column-per-stage live view that becomes the default for `effectiveMode === "live"`, backed by an endpoint whose every field derives from a single shooter's own scorecard.

**Architecture:** A pure projection function turns the already-cached `RawScorecard[]` into a narrow `LiveGridResponse`. A thin route wires cache reads to that function. Client components render a sticky-column grid with snap-scrolling stage columns and a tap-through detail sheet. Nothing computes across the field, which is what lets Phase 2 swap the data source server-side without touching the client.

**Tech Stack:** Next.js 16 Route Handlers, TanStack Query v5, Tailwind v4, shadcn/ui, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-live-grid-design.md`

## Global Constraints

- `pnpm -w run lint`, `pnpm -w run typecheck`, `pnpm -w test` must all produce **zero** errors and zero warnings before any commit.
- Mobile-first. Design at **390px**. No horizontal page overflow at any width. Minimum **44x44px** touch targets.
- **Zero new design tokens.** Use `--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--destructive`, `--perf-red`, `--perf-amber`, `--perf-green`, and the four zone literals already in `components/hit-zone-bar.tsx`.
- CSS variables are complete OKLCH values. Use `var(--token)` directly in inline styles. **Never** `hsl(var(--token))`.
- All interfaces live in `lib/types.ts`. No inline types in components.
- WCAG 2.1 AA. Colour is never the sole carrier of information (SC 1.4.1).
- `lib/graphql.ts` is server-only. Never import it from a client component.
- **Do not bump `CACHE_SCHEMA_VERSION`.** Phase 1 reads the existing cached shape and adds no fields to it.
- **Do not introduce a second poll clock.** Reuse `computeMatchFreshness`.
- `ns` maps from SSI's `penalty` field. `c_hits` already combines B-zone and C-zone (`lib/scorecard-data.ts:92`).

---

### Task 1: Types and the pure projection

**Files:**
- Modify: `lib/types.ts` (append near the other response interfaces)
- Create: `lib/live-grid.ts`
- Test: `tests/unit/live-grid.test.ts`

**Interfaces:**
- Consumes: `RawScorecard` from `@/app/api/compare/logic`, `CompetitorInfo` and `CacheInfo` from `@/lib/types`.
- Produces: `LiveGridCell`, `LiveGridStage`, `LiveGridShooter`, `LiveGridResponse` (all exported from `lib/types.ts`); `buildLiveGridCells(scorecards: RawScorecard[], competitorIds: number[]): Record<number, Record<number, LiveGridCell>>` and `computeLiveEdgeStageId(cells, stages): number | null` (both exported from `lib/live-grid.ts`).

- [ ] **Step 1: Add the types to `lib/types.ts`**

```ts
/** One shooter's result on one stage. Every field derives from that
 *  shooter's own scorecard -- no field-wide context. See
 *  docs/superpowers/specs/2026-08-23-live-grid-design.md. */
export interface LiveGridCell {
  hf: number | null;
  time: number | null;
  points: number | null;
  a: number | null;
  /** B-zone is already folded into C by parseRawScorecards. */
  c: number | null;
  d: number | null;
  m: number | null;
  /** From SSI's `penalty` field. */
  ns: number | null;
  p: number | null;
  status: "scored" | "dq" | "zeroed" | "not_fired" | "incomplete" | "pending";
  /** Scorecard creation timestamp; drives live-edge detection. */
  created: string | null;
}

export interface LiveGridStage {
  stage_id: number;
  stage_num: number;
  name: string;
  max_points: number;
}

export interface LiveGridShooter {
  id: number;
  shooterId: number | null;
  name: string;
  competitor_number: string;
  division: string | null;
  squad: string | null;
}

export interface LiveGridResponse {
  match_id: number;
  stages: LiveGridStage[];
  shooters: LiveGridShooter[];
  /** cells[competitorId][stageId] */
  cells: Record<number, Record<number, LiveGridCell>>;
  cacheInfo: CacheInfo;
  scorecardsRestricted?: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/live-grid.test.ts
import { describe, expect, it } from "vitest";
import { buildLiveGridCells, computeLiveEdgeStageId } from "@/lib/live-grid";
import type { RawScorecard } from "@/app/api/compare/logic";
import type { LiveGridStage } from "@/lib/types";

function card(over: Partial<RawScorecard> = {}): RawScorecard {
  return {
    competitor_id: 1, competitor_division: "Production",
    stage_id: 10, stage_number: 1, stage_name: "Cold Start",
    max_points: 60, points: 55, hit_factor: 5.5, time: 10,
    dq: false, zeroed: false, dnf: false, incomplete: false,
    a_hits: 10, c_hits: 2, d_hits: 0,
    miss_count: 0, no_shoots: 0, procedurals: 0,
    scorecard_created: "2026-08-23T09:00:00Z",
    ...over,
  };
}

const STAGES: LiveGridStage[] = [
  { stage_id: 10, stage_num: 1, name: "Cold Start", max_points: 60 },
  { stage_id: 11, stage_num: 2, name: "Doubles", max_points: 40 },
];

describe("buildLiveGridCells", () => {
  it("keys cells by competitor then stage", () => {
    const cells = buildLiveGridCells([card()], [1]);
    expect(cells[1][10].hf).toBe(5.5);
    expect(cells[1][10].status).toBe("scored");
  });

  it("ignores competitors that were not requested", () => {
    const cells = buildLiveGridCells([card(), card({ competitor_id: 99 })], [1]);
    expect(cells[99]).toBeUndefined();
  });

  it("maps no_shoots to ns and keeps B+C folded in c", () => {
    const cells = buildLiveGridCells([card({ no_shoots: 2, c_hits: 3 })], [1]);
    expect(cells[1][10].ns).toBe(2);
    expect(cells[1][10].c).toBe(3);
  });

  it("classifies dq, zeroed, not_fired and incomplete ahead of scored", () => {
    const s = (o: Partial<RawScorecard>) =>
      buildLiveGridCells([card(o)], [1])[1][10].status;
    expect(s({ dq: true })).toBe("dq");
    expect(s({ zeroed: true })).toBe("zeroed");
    expect(s({ dnf: true })).toBe("not_fired");
    expect(s({ incomplete: true })).toBe("incomplete");
  });

  it("prefers dq over every other flag", () => {
    const cells = buildLiveGridCells([card({ dq: true, zeroed: true, dnf: true })], [1]);
    expect(cells[1][10].status).toBe("dq");
  });

  it("returns an empty map for a competitor with no cards", () => {
    expect(buildLiveGridCells([], [1])).toEqual({ 1: {} });
  });
});

describe("computeLiveEdgeStageId", () => {
  it("picks the stage holding the newest scorecard", () => {
    const cells = buildLiveGridCells(
      [
        card({ stage_id: 10, scorecard_created: "2026-08-23T09:00:00Z" }),
        card({ stage_id: 11, stage_number: 2, scorecard_created: "2026-08-23T11:00:00Z" }),
      ],
      [1],
    );
    expect(computeLiveEdgeStageId(cells, STAGES)).toBe(11);
  });

  it("returns the first stage when nothing has been scored", () => {
    expect(computeLiveEdgeStageId({ 1: {} }, STAGES)).toBe(10);
  });

  it("returns null when there are no stages", () => {
    expect(computeLiveEdgeStageId({}, [])).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/unit/live-grid.test.ts`
Expected: FAIL, cannot resolve `@/lib/live-grid`.

- [ ] **Step 4: Implement `lib/live-grid.ts`**

```ts
import type { RawScorecard } from "@/app/api/compare/logic";
import type { LiveGridCell, LiveGridStage } from "@/lib/types";

/**
 * Project raw scorecards into the live grid's cell map.
 *
 * Deliberately field-blind: every value comes from the shooter's own card.
 * Nothing here may consult other competitors -- that invariant is what lets
 * the Phase 2 per-competitor fetch drop in without a client change.
 */
export function buildLiveGridCells(
  scorecards: RawScorecard[],
  competitorIds: number[],
): Record<number, Record<number, LiveGridCell>> {
  const wanted = new Set(competitorIds);
  const out: Record<number, Record<number, LiveGridCell>> = {};
  for (const id of competitorIds) out[id] = {};

  for (const sc of scorecards) {
    if (!wanted.has(sc.competitor_id)) continue;
    out[sc.competitor_id][sc.stage_id] = {
      hf: sc.hit_factor,
      time: sc.time,
      points: sc.points,
      a: sc.a_hits,
      c: sc.c_hits,
      d: sc.d_hits,
      m: sc.miss_count,
      ns: sc.no_shoots,
      p: sc.procedurals,
      status: classify(sc),
      created: sc.scorecard_created ?? null,
    };
  }
  return out;
}

// Order matters: a DQ'd card can also carry zeroed/dnf flags, and DQ is the
// one the shooter needs to see.
function classify(sc: RawScorecard): LiveGridCell["status"] {
  if (sc.dq) return "dq";
  if (sc.zeroed) return "zeroed";
  if (sc.dnf) return "not_fired";
  if (sc.incomplete) return "incomplete";
  return "scored";
}

/**
 * The stage the visible shooters most recently produced a scorecard on.
 * The grid opens scrolled here, because it is the stage they just shot.
 * Falls back to the first stage so a pre-scoring match still lands somewhere.
 */
export function computeLiveEdgeStageId(
  cells: Record<number, Record<number, LiveGridCell>>,
  stages: LiveGridStage[],
): number | null {
  if (stages.length === 0) return null;
  let bestStage: number | null = null;
  let bestAt = "";
  for (const byStage of Object.values(cells)) {
    for (const [stageId, cell] of Object.entries(byStage)) {
      if (!cell.created) continue;
      if (cell.created > bestAt) {
        bestAt = cell.created;
        bestStage = Number(stageId);
      }
    }
  }
  return bestStage ?? stages[0].stage_id;
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/unit/live-grid.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the full gate**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test`
Expected: zero errors, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/live-grid.ts tests/unit/live-grid.test.ts
git commit -m "feat(live-grid): field-blind projection from raw scorecards"
```

---

### Task 2: The `/api/live-grid` route

**Files:**
- Create: `app/api/live-grid/route.ts`
- Test: `tests/unit/live-grid-route.test.ts`

**Interfaces:**
- Consumes: `buildLiveGridCells` from Task 1; `getMatchScorecards` from `@/lib/scorecards-archive`; `parseRawScorecards` from `@/lib/scorecard-data`; `cachedExecuteQuery`, `gqlCacheKey`, `MATCH_QUERY` from `@/lib/graphql`.
- Produces: `GET /api/live-grid?ct=&id=&competitor_ids=` returning `LiveGridResponse`.

Read `app/api/compare/route.ts:77-250` first. This route mirrors its cache and freshness handling but stops before `computeGroupRankings`.

- [ ] **Step 1: Add the row cap constant**

In `lib/constants.ts`, below `MAX_COMPETITORS`:

```ts
/** Live grid rows. Higher than MAX_COMPETITORS because a squad can exceed 14
 *  and the grid's per-row cost is one scorecard slice, not a field-wide compute. */
export const MAX_LIVE_GRID_ROWS = 20;
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/live-grid-route.test.ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/live-grid/route";

async function call(qs: string) {
  const res = await GET(new Request(`http://localhost/api/live-grid?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/live-grid validation", () => {
  it("400s without ct", async () => {
    expect((await call("id=1&competitor_ids=1")).status).toBe(400);
  });

  it("400s without competitor_ids", async () => {
    expect((await call("ct=22&id=1")).status).toBe(400);
  });

  it("400s on a non-numeric ct", async () => {
    expect((await call("ct=abc&id=1&competitor_ids=1")).status).toBe(400);
  });

  it("400s past MAX_LIVE_GRID_ROWS", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    expect((await call(`ct=22&id=1&competitor_ids=${ids}`)).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/unit/live-grid-route.test.ts`
Expected: FAIL, cannot resolve `@/app/api/live-grid/route`.

- [ ] **Step 4: Implement the route**

Mirror `app/api/compare/route.ts` for the cache/TTL/SWR/short-circuit blocks, then diverge. Required behaviour, in order:

1. `maybeTagAsMcp(req)`, then `checkRateLimit(req, { prefix: "live-grid", limit: 60, windowSeconds: 60 })`. The limit is higher than compare's 30 because the response is far cheaper.
2. Validate `ct`, `id`, `competitor_ids`. Reject empty or `> MAX_LIVE_GRID_ROWS` with 400.
3. Fetch match metadata exactly as `compare/route.ts:122-186` does, including the `computeMatchSwrTtl` / `cache.persist` / `refreshCachedMatchQuery` handling. Copy it; do not invent a variant.
4. If `!isComplete && !matchData.event?.is_live_scores_accessible`, return a `LiveGridResponse` with empty `stages`/`shooters`/`cells` and `scorecardsRestricted: true`.
5. `getMatchScorecards({ ct, matchId, stages, ttlSeconds, freshnessSeconds })` with the same arguments compare uses.
6. `parseRawScorecards(scorecardsData)`, then `buildLiveGridCells(raw, competitorIds)`.
7. Build `stages` from `matchData.event.stages` and `shooters` from `competitors_approved_w_wo_results_not_dnf` filtered to `competitorIds`, resolving `squad` from `matchData.event.squads`.
8. Set `cacheInfo` with `cachedAt`, `scorecardsCachedAt`, `lastScorecardAt`, plus `upstreamDegraded` / `upstreamPaused` exactly as compare does.

**Do not call** `computeGroupRankings`, `computeMatchPointTotals`, `computeFieldPPSDistribution`, or any other function from `app/api/compare/logic.ts` besides the `RawScorecard` type. Add this comment above the handler:

```ts
// Field-blind by contract. Every value returned here comes from one
// shooter's own scorecard plus the stage list. Adding a stage-winner HF,
// field median, or ranking would break the Phase 2 swap described in
// docs/superpowers/specs/2026-08-23-live-grid-design.md.
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/unit/live-grid-route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify no field-wide compute leaked in**

Run: `grep -n "computeGroupRankings\|computeMatchPointTotals\|computeFieldPPS\|divisionDistributions" app/api/live-grid/route.ts`
Expected: no output.

- [ ] **Step 7: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add app/api/live-grid/route.ts tests/unit/live-grid-route.test.ts lib/constants.ts
git commit -m "feat(live-grid): add /api/live-grid endpoint"
```

---

### Task 3: The cell

**Files:**
- Create: `components/live-grid-cell.tsx`
- Test: `tests/components/live-grid-cell.test.tsx`

**Interfaces:**
- Consumes: `LiveGridCell` from `@/lib/types`.
- Produces: `<LiveGridCellView cell={...} />`, a default export-free named export.

This is proposal C from the spec: the zone bar draws only when points were dropped, and a clean run gets a circle plus `ALL A`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/live-grid-cell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveGridCellView } from "@/components/live-grid-cell";
import type { LiveGridCell } from "@/lib/types";

function cell(over: Partial<LiveGridCell> = {}): LiveGridCell {
  return {
    hf: 5.42, time: 16.42, points: 89,
    a: 16, c: 0, d: 0, m: 0, ns: 0, p: 0,
    status: "scored", created: "2026-08-23T09:00:00Z",
    ...over,
  };
}

describe("LiveGridCellView", () => {
  it("shows hit factor and time for a scored run", () => {
    render(<LiveGridCellView cell={cell()} />);
    expect(screen.getByText("5.42")).toBeInTheDocument();
    expect(screen.getByText("16.42")).toBeInTheDocument();
  });

  it("marks an all-alpha run with an accessible clean label", () => {
    render(<LiveGridCellView cell={cell()} />);
    expect(screen.getByLabelText("All alpha, clean stage")).toBeInTheDocument();
  });

  it("drops the clean marker as soon as a single charlie appears", () => {
    render(<LiveGridCellView cell={cell({ c: 1 })} />);
    expect(screen.queryByLabelText("All alpha, clean stage")).not.toBeInTheDocument();
  });

  it("drops the clean marker for a penalty even with all alphas", () => {
    render(<LiveGridCellView cell={cell({ ns: 1 })} />);
    expect(screen.queryByLabelText("All alpha, clean stage")).not.toBeInTheDocument();
  });

  it("renders DQ instead of a score", () => {
    render(<LiveGridCellView cell={cell({ status: "dq" })} />);
    expect(screen.getByText("DQ")).toBeInTheDocument();
    expect(screen.queryByText("5.42")).not.toBeInTheDocument();
  });

  it("renders ZERO with the time still visible", () => {
    render(<LiveGridCellView cell={cell({ status: "zeroed" })} />);
    expect(screen.getByText("ZERO")).toBeInTheDocument();
    expect(screen.getByText("16.42")).toBeInTheDocument();
  });

  it("renders a pending placeholder when the stage is not yet shot", () => {
    render(<LiveGridCellView cell={cell({ status: "pending", hf: null, time: null })} />);
    expect(screen.getByLabelText("Not shot yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/components/live-grid-cell.test.tsx`
Expected: FAIL, cannot resolve `@/components/live-grid-cell`.

- [ ] **Step 3: Implement the cell**

Rules the implementation must satisfy:
- `isClean = (c ?? 0) + (d ?? 0) + (m ?? 0) + (ns ?? 0) + (p ?? 0) === 0` and `status === "scored"`.
- Clean renders a 7px `rounded-full` span in `--zone-a` plus the text `ALL A`, wrapped in `role="img" aria-label="All alpha, clean stage"`. Circle is load-bearing: it is the one shape the zone bar (rectangle) and penalty pips (square, triangle, diamond) do not use, so the marker survives greyscale and CVD.
- Not clean renders the A/C/D proportional bar with the same pattern fills and the same hex literals as `components/hit-zone-bar.tsx`, plus penalty pips with counts.
- Hit factor `toFixed(2)`, time `toFixed(2)`, both `tabular-nums` and `font-mono`.
- `status` of `"pending"` / `"not_fired"` renders an em dash with `aria-label="Not shot yet"`.

Reuse the pattern-fill CSS approach from `hit-zone-bar.tsx` rather than reinventing it.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/components/live-grid-cell.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add components/live-grid-cell.tsx tests/components/live-grid-cell.test.tsx
git commit -m "feat(live-grid): quiet-by-default cell with all-alpha marker"
```

---

### Task 4: The detail sheet

**Files:**
- Create: `components/live-grid-sheet.tsx`
- Test: `tests/components/live-grid-sheet.test.tsx`

**Interfaces:**
- Consumes: `LiveGridCell`, `LiveGridStage`, `LiveGridShooter` from `@/lib/types`.
- Produces: `<LiveGridSheet cell shooter stage open onClose />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/live-grid-sheet.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveGridSheet } from "@/components/live-grid-sheet";
import type { LiveGridCell, LiveGridShooter, LiveGridStage } from "@/lib/types";

const SHOOTER: LiveGridShooter = {
  id: 1, shooterId: 500, name: "Mathias Axell",
  competitor_number: "118", division: "Production", squad: "4",
};
const STAGE: LiveGridStage = {
  stage_id: 10, stage_num: 4, name: "Steel Alley", max_points: 60,
};
function cell(over: Partial<LiveGridCell> = {}): LiveGridCell {
  return {
    hf: 5.42, time: 16.42, points: 48,
    a: 8, c: 2, d: 1, m: 0, ns: 1, p: 0,
    status: "scored", created: "2026-08-23T09:00:00Z", ...over,
  };
}

describe("LiveGridSheet", () => {
  it("names the shooter and the stage", () => {
    render(<LiveGridSheet open cell={cell()} shooter={SHOOTER} stage={STAGE} onClose={vi.fn()} />);
    expect(screen.getByText("Mathias Axell")).toBeInTheDocument();
    expect(screen.getByText(/Steel Alley/)).toBeInTheDocument();
  });

  it("shows points against the stage max", () => {
    render(<LiveGridSheet open cell={cell()} shooter={SHOOTER} stage={STAGE} onClose={vi.fn()} />);
    expect(screen.getByText("48")).toBeInTheDocument();
    expect(screen.getByText("/60")).toBeInTheDocument();
  });

  it("lists no-shoots as their own row", () => {
    render(<LiveGridSheet open cell={cell()} shooter={SHOOTER} stage={STAGE} onClose={vi.fn()} />);
    expect(screen.getByText("no-shoot")).toBeInTheDocument();
  });

  it("omits zero-count zones", () => {
    render(<LiveGridSheet open cell={cell({ p: 0 })} shooter={SHOOTER} stage={STAGE} onClose={vi.fn()} />);
    expect(screen.queryByText("procedural")).not.toBeInTheDocument();
  });

  it("celebrates a clean stage instead of showing a drop", () => {
    render(
      <LiveGridSheet open shooter={SHOOTER} stage={STAGE} onClose={vi.fn()}
        cell={cell({ a: 12, c: 0, d: 0, m: 0, ns: 0, p: 0, points: 60 })} />,
    );
    expect(screen.getByText("Clean stage")).toBeInTheDocument();
  });

  it("is a modal dialog", () => {
    render(<LiveGridSheet open cell={cell()} shooter={SHOOTER} stage={STAGE} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/components/live-grid-sheet.test.tsx`
Expected: FAIL, cannot resolve `@/components/live-grid-sheet`.

- [ ] **Step 3: Implement the sheet**

Content, all derived from `cell` plus `stage.max_points`:
- Header: shooter name, `Stage {stage_num} - {name} - {division}`, close button.
- Three metrics: hit factor `toFixed(4)`, time `toFixed(2)`, `points` with a muted `/{max_points}`.
- Zone rows, omitting any zero count: alpha, charlie (`-2` each), delta (`-4` each), miss (`-15` each), no-shoot (`-10` each), procedural (`-10` each). Each row carries the same shape marker as the cell, so the row is not colour-only.
- Points-dropped summary: `hitLoss = c*2 + d*4 + m*5`, `penLoss = (m + ns)*10 + p*10`. When the sum is zero, render `Clean stage` instead.
- `HF if clean` = `stage.max_points / time`.
- Footer stating the figures come from this shooter's own scorecard.

Use `role="dialog" aria-modal="true"`, and return focus to the invoking cell on close.

Note the scoring constants assume Minor (A5/C3/D1). Add a `TODO(major-scoring)` comment: Major is A5/C4/D2, which changes `hitLoss`. Out of scope for Phase 1, but do not silently present Minor numbers as universal -- label the section `Points dropped (minor)` until Major is handled.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/components/live-grid-sheet.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add components/live-grid-sheet.tsx tests/components/live-grid-sheet.test.tsx
git commit -m "feat(live-grid): scorecard detail sheet"
```

---

### Task 5a: Resolving which shooters fill the rows

**Files:**
- Create: `lib/live-grid-rows.ts`
- Test: `tests/unit/live-grid-rows.test.ts`

**Interfaces:**
- Consumes: `CompetitorInfo`, `SquadInfo` from `@/lib/types`; `MAX_LIVE_GRID_ROWS` from `@/lib/constants`.
- Produces: `type GridRowSource = "squad" | "tracked"` and
  `resolveGridRows(args: { source: GridRowSource; competitors: CompetitorInfo[]; squads: SquadInfo[]; myShooterId: number | null; trackedShooterIds: Set<number>; fallback: number[] }): number[]`.

The spec says rows come from `squads[].competitorIds` or the tracked shooter IDs, both free from the cached `GetMatch`. That resolution is pure and fiddly, so it gets its own tested function rather than living inline in the component.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveGridRows } from "@/lib/live-grid-rows";
import type { CompetitorInfo, SquadInfo } from "@/lib/types";

const comp = (id: number, shooterId: number | null): CompetitorInfo => ({
  id, shooterId, name: `C${id}`, competitor_number: String(id),
  club: null, division: "Production", region: null,
  region_display: null, category: null, ics_alias: null, license: null,
});
const COMPETITORS = [comp(1, 500), comp(2, 501), comp(3, 502), comp(4, null)];
const SQUADS: SquadInfo[] = [
  { id: 90, number: 4, display: "Squad 4", competitorIds: [1, 2, 3] } as SquadInfo,
  { id: 91, number: 5, display: "Squad 5", competitorIds: [4] } as SquadInfo,
];

describe("resolveGridRows", () => {
  it("returns my squad-mates when source is squad", () => {
    expect(
      resolveGridRows({ source: "squad", competitors: COMPETITORS, squads: SQUADS,
        myShooterId: 500, trackedShooterIds: new Set(), fallback: [] }),
    ).toEqual([1, 2, 3]);
  });

  it("falls back to the existing selection when I am in no squad", () => {
    expect(
      resolveGridRows({ source: "squad", competitors: COMPETITORS, squads: SQUADS,
        myShooterId: 999, trackedShooterIds: new Set(), fallback: [2, 3] }),
    ).toEqual([2, 3]);
  });

  it("maps tracked shooter IDs to this match's competitor IDs", () => {
    expect(
      resolveGridRows({ source: "tracked", competitors: COMPETITORS, squads: SQUADS,
        myShooterId: 500, trackedShooterIds: new Set([502]), fallback: [] }),
    ).toEqual([1, 3]);
  });

  it("drops tracked shooters who are not in this match", () => {
    expect(
      resolveGridRows({ source: "tracked", competitors: COMPETITORS, squads: SQUADS,
        myShooterId: null, trackedShooterIds: new Set([501, 8888]), fallback: [] }),
    ).toEqual([2]);
  });

  it("never exceeds MAX_LIVE_GRID_ROWS", () => {
    const many = Array.from({ length: 30 }, (_, i) => comp(i + 1, i + 1));
    const squad = [{ id: 1, number: 1, display: "S1",
      competitorIds: many.map((c) => c.id) } as SquadInfo];
    expect(
      resolveGridRows({ source: "squad", competitors: many, squads: squad,
        myShooterId: 1, trackedShooterIds: new Set(), fallback: [] }),
    ).toHaveLength(20);
  });

  it("puts me first so my row is the one already on screen", () => {
    const rows = resolveGridRows({ source: "tracked", competitors: COMPETITORS,
      squads: SQUADS, myShooterId: 502, trackedShooterIds: new Set([500]), fallback: [] });
    expect(rows[0]).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/unit/live-grid-rows.test.ts`
Expected: FAIL, cannot resolve `@/lib/live-grid-rows`.

- [ ] **Step 3: Implement `lib/live-grid-rows.ts`**

```ts
import { MAX_LIVE_GRID_ROWS } from "@/lib/constants";
import type { CompetitorInfo, SquadInfo } from "@/lib/types";

export type GridRowSource = "squad" | "tracked";

export interface ResolveGridRowsArgs {
  source: GridRowSource;
  competitors: CompetitorInfo[];
  squads: SquadInfo[];
  myShooterId: number | null;
  trackedShooterIds: Set<number>;
  /** The user's existing competitor selection, used when the chosen
   *  source resolves to nothing (no squad, or nothing tracked here). */
  fallback: number[];
}

export function resolveGridRows(args: ResolveGridRowsArgs): number[] {
  const { source, competitors, squads, myShooterId, trackedShooterIds, fallback } = args;

  const myCompetitorId =
    myShooterId == null
      ? null
      : competitors.find((c) => c.shooterId === myShooterId)?.id ?? null;

  let ids: number[];
  if (source === "squad") {
    const squad =
      myCompetitorId == null
        ? undefined
        : squads.find((s) => s.competitorIds.includes(myCompetitorId));
    ids = squad ? [...squad.competitorIds] : [];
  } else {
    const wanted = new Set(trackedShooterIds);
    if (myShooterId != null) wanted.add(myShooterId);
    ids = competitors.filter((c) => c.shooterId != null && wanted.has(c.shooterId)).map((c) => c.id);
  }

  if (ids.length === 0) ids = [...fallback];

  // My own row leads, so it is the one already on screen before any scrolling.
  if (myCompetitorId != null && ids.includes(myCompetitorId)) {
    ids = [myCompetitorId, ...ids.filter((id) => id !== myCompetitorId)];
  }
  return ids.slice(0, MAX_LIVE_GRID_ROWS);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/unit/live-grid-rows.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add lib/live-grid-rows.ts tests/unit/live-grid-rows.test.ts
git commit -m "feat(live-grid): resolve squad and tracked row sources"
```

**Before implementing:** confirm the real field names on `SquadInfo` at `lib/types.ts:63-68`. The fixtures above use `id`, `number`, `display`, `competitorIds` with a `as SquadInfo` cast; if the actual shape differs, fix the fixtures rather than casting around it.

---

### Task 5: Data access and the grid shell

**Files:**
- Modify: `lib/api.ts` (add `fetchLiveGrid`)
- Modify: `lib/queries.ts` (add `useLiveGridQuery`)
- Create: `components/live-grid.tsx`
- Test: `tests/components/live-grid.test.tsx`

**Interfaces:**
- Consumes: `LiveGridCellView` (Task 3), `LiveGridSheet` (Task 4), `LiveGridResponse` and `computeLiveEdgeStageId` (Task 1), `resolveGridRows` (Task 5a).
- Produces:

```ts
interface LiveGridProps {
  ct: string;
  id: string;
  shooters: number[];           // competitor IDs, already resolved
  matchName: string;
  myShooterId?: number | null;
  source: GridRowSource;        // from Task 5a
  onSourceChange: (s: GridRowSource) => void;
  onExit: () => void;           // switches to the deep comparison table
}
export function LiveGrid(props: LiveGridProps): React.ReactElement;
```

- [ ] **Step 1: Add `fetchLiveGrid` to `lib/api.ts`**

Follow the shape of the existing `fetchCompare`:

```ts
export async function fetchLiveGrid(
  ct: string, id: string, competitorIds: number[],
): Promise<LiveGridResponse> {
  const params = new URLSearchParams({ ct, id, competitor_ids: competitorIds.join(",") });
  const res = await fetch(`/api/live-grid?${params}`);
  if (!res.ok) throw new Error("Failed to load live grid");
  return res.json() as Promise<LiveGridResponse>;
}
```

- [ ] **Step 2: Add `useLiveGridQuery` to `lib/queries.ts`**

```ts
export function useLiveGridQuery(ct: string, id: string, competitorIds: number[]) {
  return useQuery<LiveGridResponse, Error>({
    queryKey: ["live-grid", ct, id, [...competitorIds].sort((a, b) => a - b)],
    queryFn: () => fetchLiveGrid(ct, id, competitorIds),
    // Same 30s cadence the live comparison already uses. Deliberately NOT a
    // new clock -- the server's freshness window is what actually bounds
    // upstream traffic, and a second cadence would raise refresh frequency.
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: Boolean(ct && id && competitorIds.length > 0),
  });
}
```

- [ ] **Step 3: Write the failing tests**

```tsx
// tests/components/live-grid.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveGrid } from "@/components/live-grid";
import type { LiveGridResponse } from "@/lib/types";

vi.mock("@/lib/queries", () => ({
  useLiveGridQuery: () => ({ data: FIXTURE, isLoading: false, isFetching: false, error: null }),
}));

const FIXTURE: LiveGridResponse = {
  match_id: 1,
  stages: [
    { stage_id: 10, stage_num: 1, name: "Cold Start", max_points: 60 },
    { stage_id: 11, stage_num: 2, name: "Doubles", max_points: 40 },
  ],
  shooters: [
    { id: 1, shooterId: 500, name: "Mathias Axell", competitor_number: "118",
      division: "Production", squad: "4" },
    { id: 2, shooterId: 501, name: "Jonas Berg", competitor_number: "042",
      division: "Open", squad: "4" },
  ],
  cells: {
    1: { 10: { hf: 5.42, time: 16.42, points: 55, a: 11, c: 0, d: 0, m: 0, ns: 0, p: 0,
               status: "scored", created: "2026-08-23T09:00:00Z" } },
    2: {},
  },
  cacheInfo: { cachedAt: null },
};

describe("LiveGrid", () => {
  it("renders one row per shooter", () => {
    render(<LiveGrid ct="22" id="1" shooters={[1, 2]} onExit={vi.fn()} />);
    expect(screen.getByRole("rowheader", { name: /Mathias/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Jonas/ })).toBeInTheDocument();
  });

  it("renders one column header per stage", () => {
    render(<LiveGrid ct="22" id="1" shooters={[1, 2]} onExit={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "S2" })).toBeInTheDocument();
  });

  it("gives every stage a labelled rail jump button", () => {
    render(<LiveGrid ct="22" id="1" shooters={[1, 2]} onExit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Jump to stage 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jump to stage 2" })).toBeInTheDocument();
  });

  it("marks the identity shooter with a You badge", () => {
    render(<LiveGrid ct="22" id="1" shooters={[1, 2]} myShooterId={500} onExit={vi.fn()} />);
    const row = screen.getByRole("rowheader", { name: /Mathias/ });
    expect(within(row).getByText(/you/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests and verify they fail**

Run: `pnpm -w test -- tests/components/live-grid.test.tsx`
Expected: FAIL, cannot resolve `@/components/live-grid`.

- [ ] **Step 5: Implement the grid**

Structure, matching the approved prototype:
- Root `fixed inset-0 h-[100dvh] flex flex-col bg-background`, with `env(safe-area-inset-*)` padding on the top bar and bottom edge. Lock body scroll while mounted and restore on unmount.
- Title bar: match name, source label, freshness dot using `--perf-green`, close button calling `onExit`.
- Source toggle: My squad / Tracked, plus a row count.
- Stage rail: one `<button aria-label="Jump to stage N">` per stage. `--perf-green` when every visible shooter has a card, `--foreground` for the live edge from `computeLiveEdgeStageId`, `--border` otherwise.
- Scroller: `overflow-auto` with `scroll-snap-type: x proximity`, `overscroll-behavior-x: contain`.
- A real `<table>`: `<th scope="col">` per stage, `<th scope="row">` per shooter with `position: sticky; left: 0`. Cells are `<button>` wrapping `<LiveGridCellView>`.
- Identity shooter gets the badge copied from `components/competitor-picker.tsx:148` (`bg-primary/10 text-primary`, uppercase).
- On mount, scroll the live-edge column into view.

**Touch targets:** the cell button must reach 44x44px even though the visual cell is shorter. Set `min-height: 2.75rem` on the button, and verify with the E2E check in Task 7. Do not shrink it below the floor to fit more stages.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `pnpm -w test -- tests/components/live-grid.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add lib/api.ts lib/queries.ts components/live-grid.tsx tests/components/live-grid.test.tsx
git commit -m "feat(live-grid): full-screen grid shell"
```

---

### Task 6: Make it the default live view

**Files:**
- Modify: `app/match/[ct]/[id]/match-page-client.tsx:965-980` (the comparison-views block)
- Modify: `lib/competition-store.ts` (add live-view preference)

**Interfaces:**
- Consumes: `<LiveGrid>` from Task 5.
- Produces: `saveLiveViewPreference(ct, id, view)` and `getLiveViewPreference(ct, id)` where `view` is `"grid" | "table"`.

- [ ] **Step 1: Add the preference helpers to `lib/competition-store.ts`**

Follow the existing `saveModeOverride` / `getModeOverride` pattern in that file exactly, including its localStorage key prefix and its SSR guard. Store `"grid" | "table"`, defaulting to `"grid"`.

- [ ] **Step 1b: Resolve the rows**

Hold `source` state (`GridRowSource`, default `"squad"`) in `match-page-client.tsx` and derive the row IDs:

```tsx
const gridRows = useMemo(
  () =>
    resolveGridRows({
      source: gridSource,
      competitors: match.competitors,
      squads: match.squads,
      myShooterId: identity?.shooterId ?? null,
      trackedShooterIds: trackedIds,
      fallback: selectedIds,
    }),
  [gridSource, match.competitors, match.squads, identity, trackedIds, selectedIds],
);
```

- [ ] **Step 2: Render the grid as the live default**

In the block at `match-page-client.tsx:967-969`, split the live branch:

```tsx
{effectiveMode === "live" && match.is_live_scores_accessible &&
 liveView === "grid" && gridRows.length > 0 && (
  <LiveGrid
    ct={ct}
    id={id}
    shooters={gridRows}
    myShooterId={identity?.shooterId ?? null}
    matchName={match.name}
    source={gridSource}
    onSourceChange={setGridSource}
    onExit={() => setLiveView("table")}
  />
)}
```

The existing comparison stack keeps rendering for `coaching`, and for `live` when `liveView === "table"`. Add a "Full analysis" button inside `<LiveGrid>`'s chrome that calls `onExit`, and a matching control on the table view to return to the grid.

**Do not** delete or modify `components/comparison-table.tsx`. It stays the deep view.

- [ ] **Step 3: Verify the grid is not fetching compare**

The compare query must not fire while the grid is showing. Confirm `compareEnabled` at `match-page-client.tsx:291-293` is false when `effectiveMode === "live" && liveView === "grid"`, and adjust it if not.

Run: `pnpm dev`, open a live match, and confirm in the network tab that `/api/compare` is not called while the grid is up.

- [ ] **Step 4: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test
git add app/match/'[ct]'/'[id]'/match-page-client.tsx lib/competition-store.ts
git commit -m "feat(live-grid): make the grid the default live view"
```

---

### Task 7: E2E at 390px

**Files:**
- Create: `tests/e2e/live-grid.spec.ts`

Follow the mocking approach in `tests/e2e/scoreboard.spec.ts` -- `route.fulfill()` on `/api/*`, no live key.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("live grid", () => {
  test("does not overflow the page horizontally", async ({ page }) => {
    // ...mock /api/match and /api/live-grid, then navigate
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("every cell button meets the 44px touch floor", async ({ page }) => {
    const boxes = await page.locator("table button").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height),
    );
    expect(Math.min(...boxes)).toBeGreaterThanOrEqual(44);
  });

  test("opens the detail sheet on cell tap and closes it", async ({ page }) => {
    await page.locator("table button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /close/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("rail jump scrolls the grid", async ({ page }) => {
    const scroller = page.locator("[data-live-grid-scroller]");
    const before = await scroller.evaluate((e) => e.scrollLeft);
    await page.getByRole("button", { name: "Jump to stage 12" }).click();
    await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBeGreaterThan(before);
  });
});
```

Add `data-live-grid-scroller` to the scroller element in `components/live-grid.tsx`.

Fill in the `route.fulfill()` mocks using a 12-stage, 8-shooter fixture so the rail jump has somewhere to go.

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e -- tests/e2e/live-grid.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 3: Run the full gate, then commit**

```bash
pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && pnpm test:e2e
git add tests/e2e/live-grid.spec.ts components/live-grid.tsx
git commit -m "test(live-grid): mobile e2e coverage at 390px"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md` (key directories list)
- Modify: `lib/releases.ts`
- Create: `docs/live-grid.md`

- [ ] **Step 1: Add the release entry**

Prepend a `Release` entry to `RELEASES` in `lib/releases.ts` per `docs/whats-new.md`, with an ISO `id`, `date`, `sections`, and `screenshotScenes`. A user-visible `feat` needs both a Conventional Commit PR title and a `RELEASES` entry.

- [ ] **Step 2: Write `docs/live-grid.md`**

Cover: what the grid is, the field-blind contract and why it exists, the Phase 2 plan and its spike gate, and the row-source rules. Link back to the spec.

- [ ] **Step 3: Add the new files to the `CLAUDE.md` key-directories list**

Entries for `app/api/live-grid/route.ts`, `lib/live-grid.ts`, `components/live-grid.tsx`, plus a pointer to `docs/live-grid.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md lib/releases.ts docs/live-grid.md
git commit -m "docs(live-grid): document the grid and its field-blind contract"
```

---

## Deferred to Phase 2

Gated on `scripts/spike-competitor-scorecards.ts`, which needs a weekday for SSI's API key:

- `LIVE_GRID_PER_COMPETITOR=on` and the `competitor_scorecards` fetch path
- Per-competitor cache keys (`sc:comp:{ct}:{compId}`) and watermarking
- The before/after upstream measurement

Phase 1 delivers no upstream reduction. It delivers the view, the contract, and courtside testing.
