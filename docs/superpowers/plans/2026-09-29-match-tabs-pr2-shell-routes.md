# Match Tabs PR 2 -- Shell and Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1582-line match page into three nested routes -- Grid (index), Info, Analysis -- behind a shared match shell with a bottom tab bar, and retire the Pre-match / Live / Coaching mode machinery.

**Architecture:** `app/match/[ct]/[id]/layout.tsx` prefetches the match once, emits `match-view`, and renders a client `MatchShell` (top bar + tab bar) around a `MatchGate` that owns loading/error states and provides the loaded match through `useMatch()`. Each tab is a thin server `page.tsx` plus a focused client component carved out of today's `match-page-client.tsx`. Pure URL logic lives in `lib/match-routes.ts`.

**Tech Stack:** Next.js 16 App Router (layouts persist across sibling navigation; layouts do not receive `searchParams`), React 19, TanStack Query v5, Tailwind v4, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md` -- Section 1 (all), Section 2 (grid empty / scores-hidden states only; the pre-match strip, 12px floor and Info reorder are PR 4), Section 3 (`tab-view` telemetry only; Analysis restructure is PR 3). Predecessor: PR 1 (#561) shipped `trackUi()` in `lib/ui-telemetry.ts`.

## Global Constraints

- Mobile-first at 390px; no horizontal page overflow; 44px touch targets (CLAUDE.md).
- The grid stays field-blind and `/api/compare` must never be called on the Grid route (e2e-guarded, `docs/live-grid.md`).
- `lib/graphql.ts`, `lib/usage-telemetry.ts` are server-only; never import them from a `"use client"` file.
- Tab bar: `<nav aria-label="Match sections">` with `<Link>`s and `aria-current="page"` -- not an ARIA tablist (spec Section 4).
- `/analysis?competitors=` is the single source of truth for Analysis; nothing in Analysis writes grid state (spec Section 1).
- Legacy `/match/{ct}/{id}?competitors=...` server-redirects to `/analysis?competitors=...` (spec Section 1).
- ASCII punctuation in prose, comments and UI copy written by this PR.
- `pnpm -w run lint`, `pnpm -w run typecheck`, `pnpm -w test` zero errors/warnings before each commit; e2e with `SSI_UPSTREAM_PAUSED=on`.
- The known-flaky e2e "My Shooters drawer closes on overlay click" fails intermittently on `main`; do not chase it here.
- PR title: `feat(match): grid, info and analysis tabs replace the mode toggle`. No `RELEASES` entry (PR 5 writes it; release is held until PR 5).

## Review Focus

- Analysis opened with no `?competitors`, no saved selection and no identity/tracked -> empty selection, picker visible, no crash, no `/api/compare` call with an empty id list. Test in Task 4.
- A seeded Analysis selection (from grid rows) must NOT be written to localStorage -- otherwise the grid's fallback and the next visit are silently pinned to it. Test in Task 4.
- Tab switches must not re-fire `match-view` and must not remount the shell's match query (layout persists). Test in Task 7 (e2e: one `/api/match` request across three tab switches).
- A match that fails to load (404 / private) on any tab shows the existing error copy with `role="alert"`, not a blank tab. Test in Task 3.
- Grid route with live scores hidden or zero resolvable rows renders an explanatory state, never a blank screen. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/match-routes.ts` (create) | Pure: tab list, tab <-> path mapping, legacy URL resolution, OG path, same-match referer check. |
| `lib/competition-store.ts` (modify) | Add grid row-source persistence; remove live-view prefs and mode-override read/write (keep `MODE_CHANGED` for `lib/sync.ts`). |
| `components/match-gate.tsx` (create) | Client: `useMatchQuery`, loading skeleton, error states (moved from MPC), `MatchContext` + `useMatch()`. |
| `app/match/[ct]/[id]/analysis/page.tsx` + `analysis-page-client.tsx` (create) | Analysis route: picker row, comparison block (moved from MPC), selection seeding. |
| `app/match/[ct]/[id]/info/page.tsx` + `info-page-client.tsx` (create) | Info route: match header, status notices, `PreMatchView`. |
| `app/match/[ct]/[id]/grid-page-client.tsx` (create) | Grid route client: rows, source persistence, empty / scores-hidden states. |
| `app/match/[ct]/[id]/page.tsx` (rewrite) | Legacy redirect + `GridPageClient`. |
| `components/live-grid.tsx` (modify) | No longer a fixed overlay: drop title bar, body-scroll lock, `onExit`, `matchName`. |
| `components/match-shell.tsx`, `components/match-tab-bar.tsx` (create) | Top bar + bottom tab bar; `tab-view` telemetry. |
| `app/match/[ct]/[id]/layout.tsx` (modify) | Prefetch + HydrationBoundary + `match-view` telemetry + shell. |
| `components/bottom-nav.tsx`, `components/footer.tsx`, `app/layout.tsx` (modify) | Hide global nav, spacer and footer on `/match/*`. |
| `app/match/[ct]/[id]/match-page-client.tsx`, `components/mode-toggle.tsx` (delete) | Retired. |
| Links: `components/share-button.tsx`, `components/anchor-stage-card.tsx`, `app/shooter/[shooterId]/shooter-dashboard-client.tsx` | Use `lib/match-routes.ts`. |
| `scripts/screenshot-match.ts`, `tests/e2e/*.spec.ts` | New paths. |

Branch: `git checkout main && git pull && git checkout -b feat/match-tabs-shell` (commit this plan as the first commit).

---

### Task 1: Pure route helpers

**Files:**
- Create: `lib/match-routes.ts`
- Test: `tests/unit/match-routes.test.ts`

**Interfaces:**
- Produces:
  - `MATCH_TABS = ["grid", "info", "analysis"] as const`; `type MatchTab = (typeof MATCH_TABS)[number]`
  - `matchTabHref(ct: string, id: string, tab: MatchTab): string` -- `/match/22/1`, `/match/22/1/info`, `/match/22/1/analysis`
  - `matchTabFromPath(pathname: string): MatchTab` -- suffix-based; anything unknown -> `"grid"`
  - `matchBasePath(pathname: string): string` -- strips a trailing `/info` or `/analysis`
  - `ogImagePath(pathname: string): string` -- `matchBasePath` with `/match/` -> `/api/og/match/`
  - `isSameMatchPath(path: string, ct: string, id: string): boolean` -- true for the base path and any tab of the same match
  - `resolveLegacyMatchUrl(a: { ct: string; id: string; search: string; hash: string }): string | null` -- target URL when a grid-route URL should go to Analysis, else null

- [ ] **Step 1: Write the failing tests** -- create `tests/unit/match-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MATCH_TABS,
  isSameMatchPath,
  matchBasePath,
  matchTabFromPath,
  matchTabHref,
  ogImagePath,
  resolveLegacyMatchUrl,
} from "@/lib/match-routes";

describe("matchTabHref / matchTabFromPath", () => {
  it("round-trips every tab", () => {
    for (const tab of MATCH_TABS) {
      expect(matchTabFromPath(matchTabHref("22", "1", tab))).toBe(tab);
    }
  });
  it("grid is the bare match path", () => {
    expect(matchTabHref("22", "1", "grid")).toBe("/match/22/1");
  });
  it("tolerates a trailing slash", () => {
    expect(matchTabFromPath("/match/22/1/analysis/")).toBe("analysis");
  });
  it("unknown suffixes fall back to grid", () => {
    expect(matchTabFromPath("/match/22/1/whatever")).toBe("grid");
  });
});

describe("matchBasePath / ogImagePath", () => {
  it("strips tab suffixes", () => {
    expect(matchBasePath("/match/22/1/analysis")).toBe("/match/22/1");
    expect(matchBasePath("/match/22/1/info")).toBe("/match/22/1");
    expect(matchBasePath("/match/22/1")).toBe("/match/22/1");
  });
  it("builds the OG route from any tab", () => {
    expect(ogImagePath("/match/22/1/analysis")).toBe("/api/og/match/22/1");
    expect(ogImagePath("/match/22/1")).toBe("/api/og/match/22/1");
  });
});

describe("isSameMatchPath", () => {
  it("matches the base path and every tab", () => {
    expect(isSameMatchPath("/match/22/1", "22", "1")).toBe(true);
    expect(isSameMatchPath("/match/22/1/info", "22", "1")).toBe(true);
    expect(isSameMatchPath("/match/22/1/analysis", "22", "1")).toBe(true);
  });
  it("does not match a different match that shares a prefix", () => {
    expect(isSameMatchPath("/match/22/12", "22", "1")).toBe(false);
    expect(isSameMatchPath("/match/22/1x/info", "22", "1")).toBe(false);
    expect(isSameMatchPath("/", "22", "1")).toBe(false);
  });
});

describe("resolveLegacyMatchUrl", () => {
  const base = { ct: "22", id: "1", search: "", hash: "" };
  it("returns null for a plain grid URL", () => {
    expect(resolveLegacyMatchUrl(base)).toBeNull();
  });
  it("moves ?competitors to analysis, keeping the query", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=100,200" }))
      .toBe("/match/22/1/analysis?competitors=100,200");
  });
  it("moves #stage-N anchors to analysis", () => {
    expect(resolveLegacyMatchUrl({ ...base, hash: "#stage-3" }))
      .toBe("/match/22/1/analysis#stage-3");
  });
  it("keeps both query and anchor", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=5", hash: "#stage-2" }))
      .toBe("/match/22/1/analysis?competitors=5#stage-2");
  });
  it("ignores an empty competitors param and unrelated hashes", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=" })).toBeNull();
    expect(resolveLegacyMatchUrl({ ...base, hash: "#main-content" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/match-routes.test.ts`
Expected: FAIL -- cannot resolve `@/lib/match-routes`.

- [ ] **Step 3: Implement `lib/match-routes.ts`**

```ts
// Pure URL helpers for the match tabs (Grid / Info / Analysis).
// See docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md Section 1.

export const MATCH_TABS = ["grid", "info", "analysis"] as const;
export type MatchTab = (typeof MATCH_TABS)[number];

const TAB_SUFFIX = /\/(info|analysis)\/?$/;

export function matchTabHref(ct: string, id: string, tab: MatchTab): string {
  const base = `/match/${ct}/${id}`;
  return tab === "grid" ? base : `${base}/${tab}`;
}

export function matchTabFromPath(pathname: string): MatchTab {
  const m = pathname.match(TAB_SUFFIX);
  return m ? (m[1] as MatchTab) : "grid";
}

export function matchBasePath(pathname: string): string {
  return pathname.replace(TAB_SUFFIX, "").replace(/\/$/, "");
}

export function ogImagePath(pathname: string): string {
  return matchBasePath(pathname).replace(/^\/match\//, "/api/og/match/");
}

/** True when `path` is this match's base path or any of its tabs. */
export function isSameMatchPath(path: string, ct: string, id: string): boolean {
  return matchBasePath(path) === `/match/${ct}/${id}`;
}

/**
 * Old links put comparison state on the bare match URL. The bare URL is now
 * the grid, so those links belong on Analysis. Returns the target, or null
 * when the URL is a genuine grid visit.
 */
export function resolveLegacyMatchUrl(a: {
  ct: string;
  id: string;
  search: string;
  hash: string;
}): string | null {
  const competitors = new URLSearchParams(a.search).get("competitors");
  const hasCompetitors = competitors != null && competitors.trim() !== "";
  const hasStageAnchor = /^#stage-\d+$/.test(a.hash);
  if (!hasCompetitors && !hasStageAnchor) return null;
  const query = hasCompetitors ? `?competitors=${competitors}` : "";
  const hash = hasStageAnchor ? a.hash : "";
  return `${matchTabHref(a.ct, a.id, "analysis")}${query}${hash}`;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/match-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/match-routes.ts tests/unit/match-routes.test.ts
git commit -m "feat(match): pure route helpers for match tabs"
```

---

### Task 2: Persist the grid row source

**Files:**
- Modify: `lib/competition-store.ts` (append after the live-view block, ~line 270)
- Test: `tests/unit/competition-store-grid-source.test.ts` (create)

**Interfaces:**
- Consumes: `type GridRowSource = "squad" | "tracked"` from `lib/live-grid-rows.ts`.
- Produces: `getGridSourcePreference(ct: string, id: string): GridRowSource` (default `"squad"`); `saveGridSourcePreference(ct: string, id: string, source: GridRowSource): void`. Key: `ssi_gridsource_{ct}_{id}`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGridSourcePreference,
  saveGridSourcePreference,
} from "@/lib/competition-store";

describe("grid source preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to squad", () => {
    expect(getGridSourcePreference("22", "1")).toBe("squad");
  });

  it("round-trips per match", () => {
    saveGridSourcePreference("22", "1", "tracked");
    expect(getGridSourcePreference("22", "1")).toBe("tracked");
    expect(getGridSourcePreference("22", "2")).toBe("squad");
  });

  it("treats garbage as squad", () => {
    localStorage.setItem("ssi_gridsource_22_1", "nonsense");
    expect(getGridSourcePreference("22", "1")).toBe("squad");
  });

  it("survives a throwing localStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getGridSourcePreference("22", "1")).toBe("squad");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/competition-store-grid-source.test.ts`
Expected: FAIL -- `getGridSourcePreference` is not a function.

- [ ] **Step 3: Implement** -- add `import type { GridRowSource } from "@/lib/live-grid-rows";` to the imports of `lib/competition-store.ts` and append:

```ts
// ---------------------------------------------------------------------------
// Grid row source -- squad vs tracked, remembered per match
// ---------------------------------------------------------------------------

function gridSourceKey(ct: string, id: string): string {
  return `ssi_gridsource_${ct}_${id}`;
}

export function saveGridSourcePreference(
  ct: string,
  id: string,
  source: GridRowSource,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(gridSourceKey(ct, id), source);
  } catch {
    // ignore
  }
}

export function getGridSourcePreference(ct: string, id: string): GridRowSource {
  if (typeof window === "undefined") return "squad";
  try {
    return localStorage.getItem(gridSourceKey(ct, id)) === "tracked"
      ? "tracked"
      : "squad";
  } catch {
    return "squad";
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/competition-store-grid-source.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/competition-store.ts tests/unit/competition-store-grid-source.test.ts
git commit -m "feat(match): remember the grid row source per match"
```

---

### Task 3: `MatchGate` -- shared loading / error states and `useMatch()`

**Files:**
- Create: `components/match-gate.tsx`
- Test: `tests/components/match-gate.test.tsx`

**Interfaces:**
- Consumes: `useMatchQuery(ct, id)` from `lib/queries.ts`; `MatchResponse`, `EventSummary`, `Visibility` from `lib/types.ts`.
- Produces:
  - `MatchGate({ ct, id, children }: { ct: string; id: string; children: React.ReactNode })` -- renders a loading skeleton, the error card, or `children` inside `MatchContext`.
  - `useMatch(): { ct: string; id: string; match: MatchResponse; isFetching: boolean }` -- throws if used outside `MatchGate`.

- [ ] **Step 1: Write the failing test** -- create `tests/components/match-gate.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MatchResponse } from "@/lib/types";

const useMatchQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useMatchQuery: (...a: unknown[]) => useMatchQuery(...a) }));

import { MatchGate, useMatch } from "@/components/match-gate";

function Probe() {
  const { match, ct, id } = useMatch();
  return <p>{`${ct}/${id}: ${match.name}`}</p>;
}

function renderGate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchGate ct="22" id="1"><Probe /></MatchGate>
    </QueryClientProvider>,
  );
}

describe("MatchGate", () => {
  it("shows a loading state, not children, while loading", () => {
    useMatchQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderGate();
    expect(screen.getByTestId("match-gate-loading")).toBeInTheDocument();
    expect(screen.queryByText(/22\/1/)).toBeNull();
  });

  it("renders children with the loaded match", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: false, isFetching: false,
      data: { name: "Test Match" } as MatchResponse,
    });
    renderGate();
    expect(screen.getByText("22/1: Test Match")).toBeInTheDocument();
  });

  it("shows the not-viewable copy as an alert on a 404", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, data: undefined,
      error: new Error("Match fetch failed (404): nope"),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "Match not viewable" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the generic failure copy on a non-404", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, data: undefined,
      error: new Error("Match fetch failed (502): upstream"),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "Failed to load match" })).toBeInTheDocument();
  });

  it("useMatch throws outside a gate", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/MatchGate/);
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/components/match-gate.test.tsx`
Expected: FAIL -- cannot resolve `@/components/match-gate`.

- [ ] **Step 3: Implement `components/match-gate.tsx`**

Structure (the two JSX blocks marked MOVE are copied verbatim from `app/match/[ct]/[id]/match-page-client.tsx`, with the edits listed):

```tsx
"use client";

import { createContext, useContext, useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMatchQuery } from "@/lib/queries";
import type { EventSummary, MatchResponse, Visibility } from "@/lib/types";

interface MatchContextValue {
  ct: string;
  id: string;
  match: MatchResponse;
  isFetching: boolean;
}

const MatchContext = createContext<MatchContextValue | null>(null);

export function useMatch(): MatchContextValue {
  const v = useContext(MatchContext);
  if (!v) throw new Error("useMatch() must be used inside <MatchGate>");
  return v;
}

/**
 * Owns the match query's loading and error states for every match tab, and
 * hands the loaded match to the tabs through useMatch(). Tabs can assume the
 * match is present.
 */
export function MatchGate({
  ct,
  id,
  children,
}: {
  ct: string;
  id: string;
  children: React.ReactNode;
}) {
  const matchQuery = useMatchQuery(ct, id);
  const queryClient = useQueryClient();

  // MOVE: the `knownVisibility` useMemo from match-page-client.tsx:253-272,
  // unchanged.
  const knownVisibility: Visibility | null = useMemo(() => { /* MOVE */ }, [matchQuery.isError, queryClient, ct, id]);

  const value = useMemo(
    () =>
      matchQuery.data
        ? { ct, id, match: matchQuery.data, isFetching: matchQuery.isFetching === true }
        : null,
    [ct, id, matchQuery.data, matchQuery.isFetching],
  );

  if (matchQuery.isLoading) {
    return (
      <div data-testid="match-gate-loading" className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        {/* MOVE: the skeleton children of the loading <main> from
            match-page-client.tsx:567-598 (match header + stage list +
            picker skeletons), without the outer <main> and without
            <LoadingBar>. */}
      </div>
    );
  }

  if (matchQuery.isError || !value) {
    // MOVE: match-page-client.tsx:610-690 verbatim (errMsg, isNotFound,
    // confirmedPrivate and the three-branch error card), with the outer
    // element changed from <main id="main-content" ...> to
    // <div className="min-h-[60dvh] flex flex-col items-center justify-center gap-4 p-8">.
    // The shell owns <main>.
  }

  return <MatchContext.Provider value={value}>{children}</MatchContext.Provider>;
}
```

Write the MOVE sections out in full in the file (no comments left saying MOVE). The `/* MOVE */` placeholders above are instructions to this step, not code to commit.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/components/match-gate.test.tsx && pnpm -w run typecheck`
Expected: PASS, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add components/match-gate.tsx tests/components/match-gate.test.tsx
git commit -m "feat(match): MatchGate owns match loading and error states"
```

---

### Task 4: Analysis route

**Files:**
- Create: `app/match/[ct]/[id]/analysis/page.tsx`, `app/match/[ct]/[id]/analysis/analysis-page-client.tsx`
- Create: `lib/analysis-selection.ts`, `tests/unit/analysis-selection.test.ts`
- Modify: `tests/e2e/scoreboard.spec.ts` (match-page tests), `tests/e2e/drawer-collapsible-toggle.spec.ts` (all `/match/22/99999999?competitors=100,200` gotos)

**Interfaces:**
- Consumes: `MatchGate`, `useMatch()` (Task 3); `resolveGridRows` (`lib/live-grid-rows.ts`); `getGridSourcePreference` (Task 2); `detectMatchView` (`lib/mode.ts`); `trackUi` (PR 1).
- Produces:
  - `initialAnalysisSelection(a: { urlIds: number[]; savedIds: number[]; gridRows: number[] }): { ids: number[]; seeded: boolean }` -- URL wins, then saved, then grid rows capped at `MAX_COMPETITORS`; `seeded` is true only for the grid-row case.
  - `analysisCompareMode(match: MatchResponse, nowMs: number): CompareMode` -- `"coaching"` when `detectMatchView` says coaching, else `"live"`.
  - Route `/match/[ct]/[id]/analysis` rendering `AnalysisPageClient` inside `MatchGate` (the shell replaces this wrapper in Task 7).

- [ ] **Step 1: Write failing selection tests** -- create `tests/unit/analysis-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analysisCompareMode, initialAnalysisSelection } from "@/lib/analysis-selection";
import { MAX_COMPETITORS } from "@/lib/constants";
import type { MatchResponse } from "@/lib/types";

describe("initialAnalysisSelection", () => {
  it("prefers the URL", () => {
    expect(initialAnalysisSelection({ urlIds: [1], savedIds: [2], gridRows: [3] }))
      .toEqual({ ids: [1], seeded: false });
  });
  it("falls back to the saved selection", () => {
    expect(initialAnalysisSelection({ urlIds: [], savedIds: [2], gridRows: [3] }))
      .toEqual({ ids: [2], seeded: false });
  });
  it("seeds from grid rows, capped, and flags it", () => {
    const rows = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = initialAnalysisSelection({ urlIds: [], savedIds: [], gridRows: rows });
    expect(r.ids).toEqual(rows.slice(0, MAX_COMPETITORS));
    expect(r.seeded).toBe(true);
  });
  it("is empty and unseeded when there is nothing", () => {
    expect(initialAnalysisSelection({ urlIds: [], savedIds: [], gridRows: [] }))
      .toEqual({ ids: [], seeded: false });
  });
});

describe("analysisCompareMode", () => {
  const base = {
    scoring_pct: 50, results_status: "org", match_status: "on",
    date: new Date("2026-09-28T08:00:00Z").toISOString(), ends: null,
  } as unknown as MatchResponse;
  const now = new Date("2026-09-28T12:00:00Z").getTime();

  it("is live while scoring is under way", () => {
    expect(analysisCompareMode(base, now)).toBe("live");
  });
  it("is coaching once results are published", () => {
    expect(analysisCompareMode({ ...base, results_status: "all" } as MatchResponse, now)).toBe("coaching");
  });
  it("is live (not prematch) before scoring starts", () => {
    expect(analysisCompareMode({ ...base, scoring_pct: 0 } as MatchResponse, now)).toBe("live");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/analysis-selection.test.ts`
Expected: FAIL -- cannot resolve `@/lib/analysis-selection`.

- [ ] **Step 3: Implement `lib/analysis-selection.ts`**

```ts
import { MAX_COMPETITORS } from "@/lib/constants";
import { detectMatchView } from "@/lib/mode";
import type { CompareMode, MatchResponse } from "@/lib/types";

/**
 * Who Analysis compares on arrival (spec Section 1): an explicit URL wins,
 * then the user's saved edit for this match, then the grid's rows. A seeded
 * selection is not the user's choice, so callers must not persist it.
 */
export function initialAnalysisSelection(a: {
  urlIds: number[];
  savedIds: number[];
  gridRows: number[];
}): { ids: number[]; seeded: boolean } {
  if (a.urlIds.length > 0) return { ids: a.urlIds, seeded: false };
  if (a.savedIds.length > 0) return { ids: a.savedIds, seeded: false };
  if (a.gridRows.length > 0) {
    return { ids: a.gridRows.slice(0, MAX_COMPETITORS), seeded: true };
  }
  return { ids: [], seeded: false };
}

/** Replaces the mode toggle: poll live until the match is done. */
export function analysisCompareMode(match: MatchResponse, nowMs: number): CompareMode {
  const startMs = match.date ? new Date(match.date).getTime() : null;
  const endMs = match.ends ? new Date(match.ends).getTime() : null;
  const view = detectMatchView({
    scoringPct: match.scoring_pct,
    daysSinceMatchStart: startMs != null ? (nowMs - startMs) / 86_400_000 : 0,
    daysSinceMatchEnd: endMs != null ? (nowMs - endMs) / 86_400_000 : null,
    resultsStatus: match.results_status,
    matchStatus: match.match_status,
    hasActualScores: false,
  });
  return view === "coaching" ? "coaching" : "live";
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/analysis-selection.test.ts`
Expected: PASS

- [ ] **Step 5: Move the scoreboard / collapsible e2e tests to `/analysis` (RED)** -- in `tests/e2e/scoreboard.spec.ts` change every `page.goto("/match/22/99999999")` inside `test.describe("Scoreboard E2E")` (tests at lines ~230, 255, 288, 319, 342) to `page.goto("/match/22/99999999/analysis")`. Leave the `?competitors` goto at ~279 and ~518 as the bare URL -- they now exercise the legacy redirect -- but add after each of them:

```ts
    await expect(page).toHaveURL(/\/match\/22\/99999999\/analysis\?competitors=/);
```

In `tests/e2e/drawer-collapsible-toggle.spec.ts` replace every `/match/22/99999999?competitors=100,200` with `/match/22/99999999/analysis?competitors=100,200`. Add one new test at the end of `scoreboard.spec.ts`'s "Scoreboard E2E" describe:

```ts
  test("analysis with no selection and no identity shows the picker and does not call compare", async ({ page }) => {
    const compareCalls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/compare")) compareCalls.push(r.url()); });
    await page.route("/api/match/22/99999999", (route) => route.fulfill({ json: MOCK_MATCH }));
    await page.goto("/match/22/99999999/analysis");
    await expect(page.getByRole("button", { name: /add competitor/i })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(compareCalls).toEqual([]);
  });
```


Run: `SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/scoreboard.spec.ts tests/e2e/drawer-collapsible-toggle.spec.ts --reporter=line`
Expected: FAIL -- `/analysis` 404s.

- [ ] **Step 6: Create `app/match/[ct]/[id]/analysis/page.tsx`**

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import { MatchGate } from "@/components/match-gate";
import AnalysisPageClient from "./analysis-page-client";

interface PageProps {
  params: Promise<{ ct: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Moved from the grid page: only Analysis carries ?competitors=, and layouts
// cannot read searchParams.
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const competitors = typeof sp.competitors === "string" ? sp.competitors : null;
  if (!competitors) return {};
  const { ct, id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
  const ogUrl = `${baseUrl}/api/og/match/${ct}/${id}?competitors=${competitors}`;
  return {
    openGraph: { images: [{ url: ogUrl, width: 1200, height: 630 }] },
    twitter: { images: [{ url: ogUrl }] },
  };
}

export default async function AnalysisPage({ params }: PageProps) {
  const { ct, id } = await params;
  // Task 7 moves MatchGate into the shell and deletes this wrapper.
  return (
    <MatchGate ct={ct} id={id}>
      <AnalysisPageClient />
    </MatchGate>
  );
}
```

- [ ] **Step 7: Create `analysis-page-client.tsx`** -- a `"use client"` default export `AnalysisPageClient()` built from `match-page-client.tsx` as follows:

  1. `const { ct, id, match } = useMatch();` replaces `useParams` and `matchQuery` (every `matchQuery.data` -> `match`; `matchQuery.isFetching` -> `isFetching` from `useMatch()`).
  2. **Copy verbatim:** the dynamic chart imports (MPC:63-140); `showCoachingView`/`showSimulator`/`showManage` state and the two telemetry open-change callbacks (MPC:143-145, 166-184); identity / tracked / career-baseline hooks (MPC:275-284); stage sort block (MPC:355-399); `handleSetMyIdentity`, `handleToggleTracked`, undo state and handlers, `moveCompetitor` (MPC:481-561); `myCompetitorId`, `aiAvailable`, `stalestCachedAt`, upstream flags (MPC:695-748, dropping `isPreMatch`); the picker row JSX (MPC:872-985); the "Match in progress" block (MPC:1005-1034, condition changed to `compareMode === "live" && !match.is_live_scores_accessible`); the comparison block (MPC:1052-1566) with the edits below; the "Select one or more" hint (MPC:1568-1572, condition `selectedIds.length === 0`); `<TrackedShootersSheet>`.
  3. **Selection state.** Replace MPC's seeding effect (195-217) and auto-select effect (409-444) with:

```tsx
  const searchParams = useSearchParams();
  const router = useRouter();
  const { identity } = useMyIdentity();
  const { trackedIds } = useTrackedShooters();

  // Grid rows, resolved exactly as the grid does, so Analysis opens on the
  // shooters the user was just looking at (spec Section 1, decision 4).
  const gridRows = useMemo(
    () =>
      resolveGridRows({
        source: getGridSourcePreference(ct, id),
        competitors: match.competitors,
        squads: match.squads,
        myShooterId: identity?.shooterId ?? null,
        trackedShooterIds: trackedIds,
        fallback: EMPTY_IDS,
      }),
    [ct, id, match, identity, trackedIds],
  );

  const savedIds = useSyncExternalStore(/* MPC:222-236 subscribe + snapshot, unchanged */);

  // Seeded ids live in memory only: persisting them would pin the next visit
  // (and the grid's fallback) to a list the user never chose.
  const [seededIds, setSeededIds] = useState<number[] | null>(null);
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const urlIds = (searchParams.get("competitors") ?? "")
      .split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const init = initialAnalysisSelection({
      urlIds,
      savedIds: getCompetitorSelectionSnapshot(ct, id),
      gridRows,
    });
    if (urlIds.length > 0) saveCompetitorSelection(ct, id, urlIds);
    if (init.seeded) setSeededIds(init.ids);
    if (urlIds.length === 0 && init.ids.length > 0) {
      router.replace(`${window.location.pathname}?competitors=${init.ids.join(",")}`, { scroll: false });
    }
  }, [ct, id, searchParams, router, gridRows]);

  const selectedIds = savedIds.length > 0 ? savedIds : seededIds ?? EMPTY_IDS;
```

     `writeSelection` (MPC:520-527) is unchanged and additionally calls `setSeededIds(null)` -- any explicit edit ends the seeded state and is persisted.
  4. **Compare mode.** Delete `modeOverride`, `autoMode`, `effectiveMode`, `preMatchEligible`, `liveView`, `gridShowing`. Add:

```tsx
  const [mountMs] = useState(() => Date.now());
  const compareMode = analysisCompareMode(match, mountMs);
  const liveScoresAccessible = match.is_live_scores_accessible === true;
  const compareEnabled = compareMode === "coaching" || liveScoresAccessible;
  const compareQuery = useCompareQuery(ct, id, compareEnabled ? selectedIds : EMPTY_IDS, compareMode);
```

     In the copied comparison block: `effectiveMode === "coaching"` -> `compareMode === "coaching"`; `effectiveMode === "live"` -> `compareMode === "live"`; delete the "Back to courtside grid" button (MPC:1058-1067); `isMatchComplete` -> `match.results_status === "all" || compareMode === "coaching"`. In `CacheInfoBadge`, `phase={compareMode === "coaching" ? "finished" : "live"}`.
  5. **Outer element.** `<div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">` (the shell owns `<main>` from Task 7), containing: `LoadingBar` (`matchLoaded` true), a compact row with `CacheInfoBadge` + `ShareButton`, the upstream banner, the picker row, the "Match in progress" block, the comparison block, the hint, the sheet. `MatchHeader`, the results disclaimer, `ModeToggle` and `PreMatchView` are NOT rendered here.
  6. Remove `saveRecentCompetition` (moves to the shell in Task 7).

- [ ] **Step 8: Run and confirm pass**

Run: `pnpm -w run typecheck && pnpm -w run lint && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/scoreboard.spec.ts tests/e2e/drawer-collapsible-toggle.spec.ts --reporter=line`
Expected: typecheck/lint clean; e2e PASS except the tests using the legacy `?competitors` bare URL (redirect lands in Task 6) -- those two may still fail here. Record which in the ledger.

- [ ] **Step 9: Seeded selection is not persisted (component test)** -- create `tests/components/analysis-seeding.test.tsx` that renders `<MatchGate ct="22" id="1"><AnalysisPageClient /></MatchGate>` inside a `QueryClientProvider`, with `next/navigation` mocked (`useSearchParams` -> `new URLSearchParams()`, `useRouter` -> `{ replace: vi.fn() }`), `@/lib/queries` mocked (`useMatchQuery` -> `{ isLoading: false, isError: false, isFetching: false, data: FIXTURE }`, `useCompareQuery` -> `{ data: undefined, isLoading: false, isFetching: false }`, `useCoachingAvailability` -> `{ data: { available: false } }`, `useShooterDashboardQuery` -> `{ data: undefined }`), identity set in `localStorage["ssi-my-shooter"]` to a shooter in squad 1 of a two-competitor fixture. Assert `localStorage.getItem("ssi_competitors_22_1")` is `null` after render and that `router.replace` was called with `?competitors=` for both squad members.

Run: `pnpm -w exec vitest run tests/components/analysis-seeding.test.tsx`
Expected: PASS (and it FAILS if the `if (urlIds.length > 0) saveCompetitorSelection` guard is removed -- verify by temporarily deleting the guard, then restore).

- [ ] **Step 10: Commit**

```bash
git add "app/match/[ct]/[id]/analysis" lib/analysis-selection.ts tests/unit/analysis-selection.test.ts tests/components/analysis-seeding.test.tsx tests/e2e/scoreboard.spec.ts tests/e2e/drawer-collapsible-toggle.spec.ts
git commit -m "feat(match): analysis tab with selection seeded from grid rows"
```

---

### Task 5: Info route

**Files:**
- Create: `app/match/[ct]/[id]/info/page.tsx`, `app/match/[ct]/[id]/info/info-page-client.tsx`
- Test: `tests/e2e/match-tabs.spec.ts` (create; grows in Tasks 6-8)

**Interfaces:**
- Consumes: `MatchGate`, `useMatch()`; `PreMatchView` props (`match, selectedIds, trackedShooterIds, myShooterId, ct, id, aiAvailable, onManageShooters`).
- Produces: route `/match/[ct]/[id]/info`.

- [ ] **Step 1: Write the failing e2e** -- create `tests/e2e/match-tabs.spec.ts`. Copy `MOCK_MATCH` and the `mockApis` / `openGrid` helpers from `tests/e2e/live-grid.spec.ts` (same 12-stage, 8-shooter, squad-4 fixture; `match_status: "on"`, `is_live_scores_accessible: true`). Add:

```ts
test.use({ viewport: { width: 390, height: 844 } });

test("info tab shows the match header and squad rotation", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888/info");
  await expect(page.getByRole("heading", { name: "Live Grid Test Match" })).toBeVisible();
  await expect(page.getByText(/results are not yet officially published/i)).toBeVisible();
});
```

where `suppressDialogs(page)` is the `addInitScript` block from `openGrid` (cell-help + whats-new keys).

Run: `SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/match-tabs.spec.ts --reporter=line`
Expected: FAIL -- 404.

- [ ] **Step 2: Create the route**

`info/page.tsx`:

```tsx
import { MatchGate } from "@/components/match-gate";
import InfoPageClient from "./info-page-client";

export default async function InfoPage({ params }: { params: Promise<{ ct: string; id: string }> }) {
  const { ct, id } = await params;
  // Task 7 moves MatchGate into the shell and deletes this wrapper.
  return (
    <MatchGate ct={ct} id={id}>
      <InfoPageClient />
    </MatchGate>
  );
}
```

`info-page-client.tsx` (`"use client"`): reads `useMatch()`, `useMyIdentity()`, `useTrackedShooters()`, `useCoachingAvailability()`, and the saved selection via `getCompetitorSelectionSnapshot(ct, id)` (read once in `useState` init -- Info does not edit it). Renders, in `<div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">`:
1. a row with `ShareEventLink` + `ShareButton` (`competitorCount={0}`);
2. the upstream degraded banner (copy MPC:786-790 with `cachedAt={match.cacheInfo.cachedAt}` and flags from `match.cacheInfo` only);
3. `<MatchHeader match={match} />`;
4. the results disclaimer (copy MPC:795-825, condition `!resultsPublished` only -- Info is not gated to pre-match);
5. `<PreMatchView ... onManageShooters={() => setShowManage(true)} />` with `aiAvailable = coachingAvailability.data?.available === true`;
6. `<TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />`.

- [ ] **Step 3: Run and confirm pass**

Run: `pnpm -w run typecheck && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/match-tabs.spec.ts --reporter=line`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "app/match/[ct]/[id]/info" tests/e2e/match-tabs.spec.ts
git commit -m "feat(match): info tab with match header, notices and pre-match content"
```

---

### Task 6: Grid as the index route, legacy redirect, retire the monolith

**Files:**
- Create: `app/match/[ct]/[id]/grid-page-client.tsx`
- Rewrite: `app/match/[ct]/[id]/page.tsx`
- Modify: `components/live-grid.tsx`
- Delete: `app/match/[ct]/[id]/match-page-client.tsx`
- Modify: `tests/e2e/live-grid.spec.ts`, `tests/e2e/match-tabs.spec.ts`, `tests/e2e/scoreboard.spec.ts` ("Match in progress" test)

**Interfaces:**
- Consumes: `resolveLegacyMatchUrl` (Task 1), `get/saveGridSourcePreference` (Task 2), `MatchGate`/`useMatch` (Task 3).
- Produces: `LiveGridProps` without `matchName` and `onExit`; `GridPageClient`.

- [ ] **Step 1: Update grid e2e (RED)** -- in `tests/e2e/live-grid.spec.ts`:
  - `openGrid`: seed the identity so squad rows resolve without `?competitors` -- add to the init script `localStorage.setItem("ssi-my-shooter", JSON.stringify({ shooterId: 500, name: "Shooter 1 Lastname", license: null }));` and change the goto to `page.goto("/match/22/88888888")`.
  - Replace the test "switching to full analysis leaves the grid" with (Task 7 adds the tab bar; until then this test is expected to fail -- keep it, it goes green in Task 7):

```ts
  test("the Analysis tab leaves the grid", async ({ page }) => {
    await openGrid(page);
    await page.getByRole("navigation", { name: "Match sections" })
      .getByRole("link", { name: /analysis/i }).click();
    await expect(page).toHaveURL(/\/analysis/);
    await expect(page.getByRole("columnheader", { name: "S1", exact: true })).toBeHidden();
  });
```

  In `tests/e2e/match-tabs.spec.ts` add:

```ts
test("legacy ?competitors link redirects to analysis", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888?competitors=100,101");
  await expect(page).toHaveURL(/\/match\/22\/88888888\/analysis\?competitors=100,101$/);
});

test("legacy #stage anchor redirects to analysis", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888#stage-3");
  await expect(page).toHaveURL(/\/analysis#stage-3$/);
});

test("grid with no resolvable rows explains how to add shooters", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888");
  await expect(page.getByRole("heading", { name: /pick your squad/i })).toBeVisible();
});

test("grid with live scores hidden explains why", async ({ page }) => {
  await suppressDialogs(page);
  await page.route("**/api/match/**", (r) =>
    r.fulfill({ json: { ...MOCK_MATCH, is_live_scores_accessible: false } }));
  await page.goto("/match/22/88888888");
  await expect(page.getByRole("heading", { name: "Match in progress" })).toBeVisible();
});
```

  In `tests/e2e/scoreboard.spec.ts`, the test "live match shows 'Match in progress' notice and never calls compare API" keeps its bare-URL goto (the grid route now owns that notice).

Run: `SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/live-grid.spec.ts tests/e2e/match-tabs.spec.ts --reporter=line`
Expected: FAIL (index route still renders the old page; redirects absent).

- [ ] **Step 2: De-overlay `components/live-grid.tsx`**
  - Remove `matchName` and `onExit` from `LiveGridProps` and the destructuring; remove the `BarChart3` import.
  - Delete the body-scroll-lock `useEffect` (lines ~64-70).
  - Delete the "Title bar" block (from `{/* Title bar */}` to its closing `</div>`).
  - Outer element: `<div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background">` -> `<div className="flex h-full min-h-0 flex-col bg-background">`.
  - Merge the "Row source" and "Stage rail" rows into one: a single `<div className="flex flex-none items-center gap-2 border-b bg-card px-3 py-1.5">` containing the two source chips followed by the rail (`flex-1` wrapper around the rail buttons and the `n/m` counter). Keep all aria labels and `aria-pressed`.
  - Update the doc comment to "fills its container; the match shell owns the viewport."

- [ ] **Step 3: Create `grid-page-client.tsx`** (`"use client"`):

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { LiveGrid } from "@/components/live-grid";
import { SquadPicker } from "@/components/squad-picker";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { useMatch } from "@/components/match-gate";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { resolveGridRows, type GridRowSource } from "@/lib/live-grid-rows";
import {
  SELECTION_CHANGED,
  getCompetitorSelectionSnapshot,
  getGridSourcePreference,
  saveCompetitorSelection,
  saveGridSourcePreference,
} from "@/lib/competition-store";
import { resolveLegacyMatchUrl } from "@/lib/match-routes";

const EMPTY_IDS: number[] = [];

export default function GridPageClient() {
  const { ct, id, match } = useMatch();
  const router = useRouter();
  const { identity } = useMyIdentity();
  const { trackedIds } = useTrackedShooters();
  const [source, setSource] = useState<GridRowSource>("squad");
  const [showManage, setShowManage] = useState(false);

  // Hash never reaches the server, so #stage-N legacy links resolve here.
  useEffect(() => {
    const target = resolveLegacyMatchUrl({ ct, id, search: "", hash: window.location.hash });
    if (target) router.replace(target);
  }, [ct, id, router]);

  useEffect(() => setSource(getGridSourcePreference(ct, id)), [ct, id]);

  const onSourceChange = (s: GridRowSource) => {
    setSource(s);
    saveGridSourcePreference(ct, id, s);
  };

  // The saved selection is the grid's last-resort row source, and the
  // empty state's squad pick writes it -- subscribe so the grid appears.
  const savedIds = useSyncExternalStore(
    useCallback(
      (onChange) => {
        const handler = (e: Event) => {
          const ev = e as CustomEvent<{ ct: string; id: string }>;
          if (ev.detail?.ct === ct && ev.detail?.id === id) onChange();
        };
        window.addEventListener(SELECTION_CHANGED, handler);
        return () => window.removeEventListener(SELECTION_CHANGED, handler);
      },
      [ct, id],
    ),
    useCallback(() => getCompetitorSelectionSnapshot(ct, id), [ct, id]),
    () => EMPTY_IDS,
  );

  const rows = useMemo(
    () =>
      resolveGridRows({
        source,
        competitors: match.competitors,
        squads: match.squads,
        myShooterId: identity?.shooterId ?? null,
        trackedShooterIds: trackedIds,
        fallback: savedIds,
      }),
    [match, source, identity, trackedIds, savedIds],
  );

  const isComplete = match.results_status === "all" || match.match_status === "cp";
  if (!match.is_live_scores_accessible && !isComplete) {
    return (
      <div className="p-4">
        {/* copy the "Match in progress" block from match-page-client.tsx:1006-1033 verbatim */}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <h2 className="text-base font-semibold">Pick your squad</h2>
        <p className="text-sm text-muted-foreground">
          Choose a squad to follow, or set yourself and the shooters you track
          in My shooters.
        </p>
        <div className="flex flex-wrap gap-2">
          {match.squads.length > 0 && (
            <SquadPicker
              squads={match.squads}
              selectedIds={[]}
              onReplaceSelection={(ids) => {
                // Following a squad = a saved selection the grid falls back to.
                saveCompetitorSelection(ct, id, ids);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => setShowManage(true)}
            className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
          >
            My shooters
          </button>
        </div>
        <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
      </div>
    );
  }

  return (
    <div className="h-full">
      <LiveGrid
        ct={ct}
        id={id}
        shooters={rows}
        myShooterId={identity?.shooterId ?? null}
        source={source}
        onSourceChange={onSourceChange}
      />
    </div>
  );
}
```

Replace the `{/* copy ... */}` comment with the "Match in progress" block from `match-page-client.tsx:1006-1033`, verbatim.

- [ ] **Step 4: Rewrite `app/match/[ct]/[id]/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { MatchGate } from "@/components/match-gate";
import { resolveLegacyMatchUrl } from "@/lib/match-routes";
import GridPageClient from "./grid-page-client";

interface PageProps {
  params: Promise<{ ct: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GridPage({ params, searchParams }: PageProps) {
  const { ct, id } = await params;
  const sp = await searchParams;
  const competitors = typeof sp.competitors === "string" ? sp.competitors : "";
  const target = resolveLegacyMatchUrl({
    ct, id, search: competitors ? `?competitors=${competitors}` : "", hash: "",
  });
  if (target) redirect(target);
  // Task 7 moves MatchGate into the shell and deletes this wrapper.
  return (
    <div className="h-[calc(100dvh-3.5rem)]">
      <MatchGate ct={ct} id={id}>
        <GridPageClient />
      </MatchGate>
    </div>
  );
}
```

The prefetch, `HydrationBoundary`, `isSameMatchSoftNav` and `match-view` telemetry leave this file; Task 7 puts them in the layout. Until Task 7, the client fetches `/api/match` itself (e2e mocks it).

- [ ] **Step 5: Delete the monolith** -- `git rm "app/match/[ct]/[id]/match-page-client.tsx"`. Fix any import left behind (`grep -rn "match-page-client" app components lib tests scripts`).

- [ ] **Step 6: Run**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/live-grid.spec.ts tests/e2e/match-tabs.spec.ts tests/e2e/scoreboard.spec.ts --reporter=line`
Expected: all PASS except "the Analysis tab leaves the grid" (needs Task 7's tab bar). Ledger it.

- [ ] **Step 7: Commit**

```bash
git add -A "app/match/[ct]/[id]" components/live-grid.tsx tests/e2e
git commit -m "feat(match): grid is the match index route; legacy links redirect to analysis"
```

---

### Task 7: Match shell, tab bar, layout prefetch, hide global chrome

**Files:**
- Create: `components/match-shell.tsx`, `components/match-tab-bar.tsx`
- Modify: `app/match/[ct]/[id]/layout.tsx`, the three `page.tsx` files (drop their `MatchGate` wrappers), `components/bottom-nav.tsx`, `components/footer.tsx`, `app/layout.tsx`
- Test: `tests/components/match-tab-bar.test.tsx` (create), `tests/e2e/match-tabs.spec.ts`

**Interfaces:**
- Consumes: `MATCH_TABS`, `matchTabHref`, `matchTabFromPath`, `isSameMatchPath` (Task 1); `MatchGate`, `useMatch` (Task 3); `trackUi` (PR 1).
- Produces: `MatchTabBar({ ct, id }: { ct: string; id: string })`; `MatchShell({ ct, id, children })`.

- [ ] **Step 1: Failing tab-bar component test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/match/22/1/info" }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));

import { MatchTabBar } from "@/components/match-tab-bar";

describe("MatchTabBar", () => {
  it("is a labelled nav of links with the active tab marked", () => {
    render(<MatchTabBar ct="22" id="1" />);
    const nav = screen.getByRole("navigation", { name: "Match sections" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/match/22/1", "/match/22/1/info", "/match/22/1/analysis",
    ]);
    expect(screen.getByRole("link", { name: /info/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /grid/i })).not.toHaveAttribute("aria-current");
  });

  it("reports the viewed tab once", () => {
    render(<MatchTabBar ct="22" id="1" />);
    expect(trackUi).toHaveBeenCalledWith({ op: "tab-view", ct: 22, tab: "info" });
  });
});
```

Run: `pnpm -w exec vitest run tests/components/match-tab-bar.test.tsx` -- Expected: FAIL (module missing).

- [ ] **Step 2: Implement `components/match-tab-bar.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Info, LayoutGrid } from "lucide-react";
import { MATCH_TABS, matchTabFromPath, matchTabHref, type MatchTab } from "@/lib/match-routes";
import { trackUi } from "@/lib/ui-telemetry";
import { cn } from "@/lib/utils";

const LABEL: Record<MatchTab, string> = { grid: "Grid", info: "Info", analysis: "Analysis" };
const ICON: Record<MatchTab, typeof Info> = { grid: LayoutGrid, info: Info, analysis: BarChart3 };

/** Bottom tab bar inside a match. Real routes, so links -- not a tablist. */
export function MatchTabBar({ ct, id }: { ct: string; id: string }) {
  const active = matchTabFromPath(usePathname());

  useEffect(() => {
    trackUi({ op: "tab-view", ct: parseInt(ct, 10), tab: active });
  }, [ct, active]);

  return (
    <nav
      aria-label="Match sections"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/90 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-stretch justify-around">
        {MATCH_TABS.map((tab) => {
          const Icon = ICON[tab];
          const current = tab === active;
          return (
            <Link
              key={tab}
              href={matchTabHref(ct, id, tab)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-w-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {LABEL[tab]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

Run the test -- Expected: PASS.

- [ ] **Step 3: Implement `components/match-shell.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MatchGate, useMatch } from "@/components/match-gate";
import { MatchTabBar } from "@/components/match-tab-bar";
import { saveRecentCompetition } from "@/lib/competition-store";

function TopBar() {
  const { ct, id, match } = useMatch();
  useEffect(() => saveRecentCompetition(ct, id, match), [ct, id, match]);
  return (
    <header className="sticky top-0 md:top-14 z-30 flex h-12 items-center gap-2 border-b bg-card px-2">
      <Link href="/" aria-label="All matches" className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{match.name}</h1>
      <span className="shrink-0 pr-2 font-mono text-xs text-muted-foreground" aria-label={`${Math.round(match.scoring_pct)} percent scored`}>
        {Math.round(match.scoring_pct)}%
      </span>
    </header>
  );
}

/**
 * Chrome for every match tab: top bar, bottom tab bar, and the MatchGate that
 * owns loading and error states. Lives in the layout, so it persists across
 * tab switches -- the match query and its polling survive navigation.
 */
export function MatchShell({ ct, id, children }: { ct: string; id: string; children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <MatchGate ct={ct} id={id}>
        <TopBar />
        <div className="min-h-0 flex-1">{children}</div>
      </MatchGate>
      <MatchTabBar ct={ct} id={id} />
    </main>
  );
}
```

Deviation from the spec, decided while planning: the spec's "7/12 stages" indicator shows scoring percent instead, because `MatchResponse.stages` (`StageInfo`) carries no per-stage scored flag -- only the match-level `scoring_pct`. The grid's own rail already shows `done/total` stages for the viewed shooters.

- [ ] **Step 4: Layout** -- rewrite the default export of `app/match/[ct]/[id]/layout.tsx` (keep `generateMetadata` unchanged):

```tsx
export default async function MatchLayout({ params, children }: Props) {
  const { ct, id } = await params;
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: matchQueryKey(ct, id),
    queryFn: async () => {
      /* MOVE: the queryFn body from the old page.tsx verbatim -- fetchMatchData,
         the match-page-ssr log line, and the match-view telemetry guarded by
         isSameMatchSoftNav -- with the log route renamed "match-layout-ssr". */
    },
  });
  return (
    <HydrationBoundary
      state={dehydrate(queryClient, {
        shouldDehydrateQuery: (query) => query.state.status === "success",
      })}
    >
      <MatchShell ct={ct} id={id}>{children}</MatchShell>
    </HydrationBoundary>
  );
}
```

Add the imports the old `page.tsx` had (`QueryClient`, `dehydrate`, `HydrationBoundary`, `fetchMatchData`, `matchQueryKey`, `usageTelemetry`, `bucketScoring`) plus `MatchShell` and `isSameMatchPath`. Move `isSameMatchSoftNav` here and make its comparison `return isSameMatchPath(path, ct, id);`.

- [ ] **Step 5: Drop the per-page gates** -- in `page.tsx`, `info/page.tsx`, `analysis/page.tsx` remove the `MatchGate` wrapper (render the client component directly). Grid page wrapper becomes `<div className="h-[calc(100dvh-3rem-3.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem-3rem-3.5rem)]"><GridPageClient /></div>` (viewport minus top bar 3rem, tab bar 3.5rem, and on md+ the site header 3.5rem).

- [ ] **Step 6: Hide global chrome on `/match/*`**
  - `components/bottom-nav.tsx`: at the top of `BottomNav()` after `usePathname()`: `if (pathname.startsWith("/match/")) return null;` -- and move the spacer `<div className="h-14 md:hidden" aria-hidden="true" />` from `app/layout.tsx` into the fragment `BottomNav` returns, so it disappears with the nav.
  - `components/footer.tsx`: add `const pathname = usePathname();` (import from `next/navigation`) and `if (pathname.startsWith("/match/")) return null;`.
  - Hooks rule: place the early returns after all hook calls in each component.

- [ ] **Step 7: e2e (RED -> GREEN)** -- add to `tests/e2e/match-tabs.spec.ts`:

```ts
test("tab switches keep one match fetch and hide the global nav", async ({ page }) => {
  await suppressDialogs(page);
  let matchFetches = 0;
  await page.route("**/api/match/**", (r) => { matchFetches++; return r.fulfill({ json: MOCK_MATCH }); });
  await page.route("**/api/live-grid**", (r) => r.fulfill({ json: MOCK_GRID }));
  await page.goto("/match/22/88888888/info");
  const tabs = page.getByRole("navigation", { name: "Match sections" });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await tabs.getByRole("link", { name: /analysis/i }).click();
  await expect(page).toHaveURL(/\/analysis/);
  await tabs.getByRole("link", { name: /grid/i }).click();
  await expect(page).toHaveURL(/\/match\/22\/88888888$/);
  await tabs.getByRole("link", { name: /info/i }).click();
  await expect(page).toHaveURL(/\/info$/);
  expect(matchFetches).toBeLessThanOrEqual(1);
});

for (const path of ["", "/info", "/analysis"]) {
  test(`no horizontal overflow at 390px on ${path || "/"}`, async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page);
    await page.goto(`/match/22/88888888${path}`);
    await expect(page.getByRole("navigation", { name: "Match sections" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}

test("tab bar links meet the 44px touch floor", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888/info");
  const heights = await page.getByRole("navigation", { name: "Match sections" })
    .getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
```

Note: `matchFetches` counts client `/api/match` calls; with the layout prefetch hydrating the cache the expected count is 0 or 1 (dev server SSR prefetch fails without an API key, so the client fetches once). It must never be 3.

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`
Expected: all PASS, including "the Analysis tab leaves the grid" from Task 6 (known flake aside). The bottom-nav tests in `scoreboard.spec.ts` run on `/` and still pass.

- [ ] **Step 8: Commit**

```bash
git add components/match-shell.tsx components/match-tab-bar.tsx components/bottom-nav.tsx components/footer.tsx app/layout.tsx "app/match/[ct]/[id]" tests/components/match-tab-bar.test.tsx tests/e2e/match-tabs.spec.ts
git commit -m "feat(match): match shell with tab bar; global nav hidden inside a match"
```

---

### Task 8: Retire mode machinery, fix links, screenshots

**Files:**
- Delete: `components/mode-toggle.tsx`
- Modify: `lib/competition-store.ts` (remove `saveModeOverride`, `getModeOverrideSnapshot`, `subscribeMode`, `modeKey`, `LiveView`, `saveLiveViewPreference`, `getLiveViewPreference`, `liveViewKey`; KEEP `MODE_CHANGED` -- `lib/sync.ts` imports it and sync payloads still carry `modeOverrides`)
- Modify: `components/share-button.tsx`, `components/anchor-stage-card.tsx:26`, `app/shooter/[shooterId]/shooter-dashboard-client.tsx:227,396`, `scripts/screenshot-match.ts`
- Test: `tests/unit/share-og-path.test.ts` is covered by Task 1's `ogImagePath` tests; add `tests/components/anchor-stage-card.test.tsx` only if one does not exist -- otherwise update its expected href.

- [ ] **Step 1: Failing link expectations** -- `grep -rn "stage-\${\|#stage-" tests` to find existing assertions on the anchor href; update them to expect `/match/{ct}/{matchId}/analysis#stage-{n}`. If none exist, create `tests/components/anchor-stage-card.test.tsx` rendering `AnchorStageCard` with `{ ct: 22, matchId: 1, stageNumber: 3, ... }` (fill the remaining `AnchorStage` fields from `lib/types.ts`) and asserting the link `href` is `/match/22/1/analysis#stage-3`.

Run the test -- Expected: FAIL (href still points at the bare match path).

- [ ] **Step 2: Implement link changes**
  - `anchor-stage-card.tsx:26`: `const matchPath = \`${matchTabHref(String(anchorStage.ct), String(anchorStage.matchId), "analysis")}#stage-${anchorStage.stageNumber}\`;` (import `matchTabHref`).
  - `shooter-dashboard-client.tsx:227` and `:396`: `const href = \`${matchTabHref(String(match.ct), String(match.matchId), "analysis")}?competitors=${match.competitorId}\`;`
  - `share-button.tsx`: replace the `ogPath` computation with `ogImagePath(window.location.pathname)` (import from `@/lib/match-routes`).

Run: `pnpm -w exec vitest run tests/components/anchor-stage-card.test.tsx tests/unit/match-routes.test.ts` -- Expected: PASS.

- [ ] **Step 3: Remove mode machinery** -- delete `components/mode-toggle.tsx`; remove the listed functions/types from `lib/competition-store.ts`. Then `pnpm -w run typecheck` and fix every reported reference (expected: none outside deleted files; `lib/sync.ts` keeps compiling because `MODE_CHANGED` stays). Add a one-line comment above `MODE_CHANGED`: `// Still dispatched by lib/sync.ts for old payloads carrying modeOverrides; nothing reads ssi_mode_* since the mode toggle was retired.`

- [ ] **Step 4: Screenshot scenes** -- in `scripts/screenshot-match.ts`: the `live-grid` scene (around line 312-334) drops the `ssi_mode_*` / `ssi_liveview_*` seeding, seeds `ssi-my-shooter` with the first mock competitor's `shooterId` instead, and navigates to `matchPath` (no `?competitors`). Scenes that `goto(\`${matchPath}?competitors=${MOCK_IDS}\`)` change to `goto(\`${matchPath}/analysis?competitors=${MOCK_IDS}\`)` (avoids a redirect hop). The scene at ~355 that navigates to bare `matchPath` for pre-match content navigates to `${matchPath}/info`.

Run: `pnpm -w run typecheck` (the script is type-checked) -- Expected: clean. If a local mock server run is cheap (`pnpm screenshots --help` or the script's own usage line), run the `live-grid` and `comparison-table` scenes once and eyeball the PNGs; otherwise ledger that screenshots were not regenerated (PR 5 regenerates them for the release entry).

- [ ] **Step 5: Full gate and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`
Expected: all green (known flake aside).

```bash
git add -A components lib app scripts tests
git commit -m "refactor(match): retire mode toggle and live-view prefs; links target tabs"
```

---

### Task 9: Open the PR

- [ ] Push `feat/match-tabs-shell`; `gh pr create --base main --title "feat(match): grid, info and analysis tabs replace the mode toggle" --body-file ~/.claude-tmp/pr2-body.md`. Body sections: **Why** (spec link, PR 2 of 5, release held until PR 5), **What** (routes, shell, tab bar, redirect, grid states, mode machinery removed, telemetry `tab-view`), **Not yet** (Analysis restructure PR 3, Info reorder + grid 12px PR 4, chrome + desktop tabs PR 5), **Tests** (commands + results), **Screens** (390px screenshots of each tab if captured). End with the Claude Code attribution footer.
