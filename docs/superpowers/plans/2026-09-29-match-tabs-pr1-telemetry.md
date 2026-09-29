# Match Tabs PR 1 -- Telemetry Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure grid time-in-view and client-side section usage before the match-tabs restructure ships, so later trimming decisions rest on data.

**Architecture:** A new server-side `live-grid-view` usage event from `/api/live-grid` (mirrors the polling `comparison` event, so the two are comparable as time-in-view). A new `POST /api/telemetry/ui` endpoint accepts a strict Zod allowlist of anonymous UI events via `navigator.sendBeacon` and forwards them to the existing `usageTelemetry()` pipeline. A client-safe `trackUi()` helper is wired into the three surfaces that exist today (coaching collapsible, stage simulator, stage-time export).

**Tech Stack:** Next.js 16 Route Handlers, Zod 3.25 (pinned major -- do not upgrade), Vitest (jsdom default; `// @vitest-environment node` for route tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md` (Section 3 "Telemetry", Section 4 "Rollout" item 1). This plan covers PR 1 only; PRs 2-5 get their own plans written after this one merges.

## Global Constraints

- Never record IP, User-Agent, shooter IDs, competitor IDs, or free text in usage events (`docs/telemetry.md` "Privacy commitments").
- Client UI events carry `ct` plus enum values only -- no match id (spec Section 3).
- Unknown ops or extra fields -> 400, not logged (spec Section 3).
- Per-IP rate limit on the endpoint; the IP is never logged.
- Any collection change updates `docs/telemetry.md` and `/legal` Section 6 in the same PR.
- `lib/usage-telemetry.ts` is server-only; never import it (even transitively) from a `"use client"` file.
- ASCII punctuation in all prose and comments: `--` not em dash.
- `pnpm -w run lint`, `pnpm -w run typecheck`, `pnpm -w test` all zero errors, zero warnings before each commit.
- Run e2e with `SSI_UPSTREAM_PAUSED=on` (SSI throttles IPs that burst dummy-key calls).
- PR title must be a Conventional Commit: `feat(telemetry): ...` (squash-merge; release-please parses the title).

## Review Focus

- Garbage beacon body (non-JSON, empty, or >1 KB) -> 400, nothing logged, no 500. Test in Task 2.
- A valid event with a smuggled extra field (e.g. `shooterId`) -> 400 via `.strict()`, not silently stripped and logged. Test in Task 2.
- `/api/live-grid` validation (400), rate-limit (429) and upstream-failure (502) responses must not emit `live-grid-view` -- only served grids count. Test in Task 1.
- Closing a collapsible must not emit; only the closed->open transition counts, or open/close cycles double the numbers. Test in Task 3 (e2e).
- `sendBeacon` missing or throwing (older Safari, jsdom) -> `fetch(..., {keepalive:true})` fallback; any failure is swallowed, never an unhandled rejection in the UI. Test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ui-telemetry-schema.ts` (create) | Client-safe Zod schema + inferred `UiTelemetryEvent` type + `CHART_IDS` + `bucketStageExportCompetitors` (moved here). No server imports. |
| `lib/ui-telemetry.ts` (create) | Client-safe `trackUi(ev)` -- sendBeacon with fetch fallback, never throws. Imports the schema file with `import type` only. |
| `app/api/telemetry/ui/route.ts` (create) | POST handler: size cap, JSON parse, schema validate, rate limit, forward to `usageTelemetry`. |
| `lib/usage-telemetry.ts` (modify) | Add `live-grid-view`, `tab-view`, `analysis-section-open`, `chart-switch` ops; `bucketGridRows`; re-export `bucketStageExportCompetitors` from the schema file. |
| `app/api/live-grid/route.ts` (modify) | Emit `live-grid-view` on both 200 responses. |
| `app/match/[ct]/[id]/match-page-client.tsx` (modify) | Emit on coaching / simulator open. |
| `components/stage-times-export.tsx` (modify) | Emit `stage-export` `surface:"ui"` on download. |
| `docs/telemetry.md`, `app/legal/page.tsx` (modify) | Document the new events and the browser-sent interaction events. |
| Tests | `tests/unit/usage-telemetry.test.ts`, `tests/unit/live-grid-route-telemetry.test.ts` (create), `tests/unit/ui-telemetry-schema.test.ts` (create), `tests/unit/telemetry-ui-route.test.ts` (create), `tests/unit/ui-telemetry.test.ts` (create), `tests/components/stage-times-export.test.tsx` (create), `tests/e2e/drawer-collapsible-toggle.spec.ts` (modify) |

Branch: `git checkout main && git pull && git checkout -b feat/telemetry-ui-baseline`

---

### Task 1: `live-grid-view` server event

**Files:**
- Modify: `lib/usage-telemetry.ts`
- Modify: `app/api/live-grid/route.ts` (two `NextResponse.json({... } satisfies LiveGridResponse)` returns near the end)
- Test: `tests/unit/usage-telemetry.test.ts`
- Create: `tests/unit/live-grid-route-telemetry.test.ts`

**Interfaces:**
- Produces: `bucketGridRows(n: number): "1" | "2-5" | "6-12" | "13-20"`; `UsageEvent` variant `{ op: "live-grid-view"; ct: number; rowsBucket: "1" | "2-5" | "6-12" | "13-20"; restricted: boolean }`.

- [ ] **Step 1: Write failing bucket + variant tests** -- append to `tests/unit/usage-telemetry.test.ts` (and add `bucketGridRows` to its import line):

```ts
describe("bucketGridRows", () => {
  it("1", () => expect(bucketGridRows(1)).toBe("1"));
  it("0 and negatives clamp to 1", () => {
    expect(bucketGridRows(0)).toBe("1");
    expect(bucketGridRows(-3)).toBe("1");
  });
  it("2-5", () => {
    expect(bucketGridRows(2)).toBe("2-5");
    expect(bucketGridRows(5)).toBe("2-5");
  });
  it("6-12", () => {
    expect(bucketGridRows(6)).toBe("6-12");
    expect(bucketGridRows(12)).toBe("6-12");
  });
  it("13-20", () => {
    expect(bucketGridRows(13)).toBe("13-20");
    expect(bucketGridRows(20)).toBe("13-20");
    expect(bucketGridRows(99)).toBe("13-20");
  });
});
```

Inside the existing `describe("usageTelemetry")` block add:

```ts
  it("emits live-grid-view with bucketed rows and no ids", () => {
    usageTelemetry({ op: "live-grid-view", ct: 22, rowsBucket: "6-12", restricted: false });
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ domain: "usage", op: "live-grid-view", ct: 22, rowsBucket: "6-12", restricted: false });
    expect(line.competitorIds).toBeUndefined();
    expect(line.matchId).toBeUndefined();
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/usage-telemetry.test.ts`
Expected: FAIL -- `bucketGridRows` is not exported; type error on `op: "live-grid-view"`.

- [ ] **Step 3: Implement in `lib/usage-telemetry.ts`** -- after `bucketStageExportCompetitors` add:

```ts
/** Bucket courtside-grid row counts. Rows are capped at MAX_LIVE_GRID_ROWS
 *  (20); the bands separate "just me", a small tracked set, a typical squad,
 *  and a large squad. */
export function bucketGridRows(n: number): "1" | "2-5" | "6-12" | "13-20" {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 12) return "6-12";
  return "13-20";
}
```

and add to the `UsageEvent` union (before the `stage-export` variant):

```ts
  | {
      // Courtside grid served. Polls every 30s like `comparison` (live), so
      // the count measures time-in-view and compares directly with live-table
      // time. `restricted` = organizer has not published live scores.
      op: "live-grid-view";
      ct: number;
      rowsBucket: "1" | "2-5" | "6-12" | "13-20";
      restricted: boolean;
    }
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/usage-telemetry.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing route-emission tests** -- create `tests/unit/live-grid-route-telemetry.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageSpy = vi.fn();
vi.mock("@/lib/usage-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage-telemetry")>()),
  usageTelemetry: (ev: unknown) => usageSpy(ev),
}));
const rateLimit = vi.fn(async () => ({ allowed: true as const }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimit() }));
vi.mock("@/lib/telemetry-context", () => ({ maybeTagAsMcp: vi.fn() }));
vi.mock("@/lib/background-impl", () => ({ afterResponse: vi.fn() }));
vi.mock("@/lib/upstream-status", () => ({ isUpstreamDegraded: vi.fn(async () => false) }));
vi.mock("@/lib/upstream-pause", () => ({ isSsiUpstreamPaused: () => false }));
vi.mock("@/lib/cache-impl", () => ({
  default: { get: vi.fn(), persist: vi.fn(), expire: vi.fn() },
}));
vi.mock("@/lib/match-data-store", () => ({ persistToMatchStore: vi.fn() }));

const cachedExecuteQuery = vi.fn();
vi.mock("@/lib/graphql", () => ({
  cachedExecuteQuery: (...a: unknown[]) => cachedExecuteQuery(...a),
  gqlCacheKey: () => "k",
  MATCH_QUERY: "q",
  refreshCachedMatchQuery: vi.fn(),
}));
vi.mock("@/lib/scorecards-archive", () => ({ getMatchScorecards: vi.fn() }));

import { GET } from "@/app/api/live-grid/route";

// Active match, live scores hidden -> the route returns early with
// scorecardsRestricted, which is still a served grid.
const RESTRICTED_MATCH = {
  event: {
    starts: new Date().toISOString(),
    status: "on",
    results: "org",
    is_live_scores_accessible: false,
    stages: [{ id: "1", number: 1, name: "S1", max_points: 60,
               scoring_progress: { scored: 1, total: 10 } }],
    competitors_approved_w_wo_results_not_dnf: [
      { id: "100", first_name: "A", last_name: "B" },
    ],
    squads: [],
  },
};

const call = (qs: string) =>
  GET(new Request(`http://localhost/api/live-grid?${qs}`));

describe("live-grid-view telemetry", () => {
  beforeEach(() => {
    usageSpy.mockReset();
    rateLimit.mockResolvedValue({ allowed: true });
    cachedExecuteQuery.mockReset();
  });

  it("emits once for a served grid with bucketed rows", async () => {
    cachedExecuteQuery.mockResolvedValue({
      data: RESTRICTED_MATCH,
      cachedAt: new Date().toISOString(),
    });
    const res = await call("ct=22&id=1&competitor_ids=100,101,102");
    expect(res.status).toBe(200);
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy).toHaveBeenCalledWith({
      op: "live-grid-view", ct: 22, rowsBucket: "2-5", restricted: true,
    });
  });

  it("does not emit on a validation 400", async () => {
    expect((await call("ct=22&id=1")).status).toBe(400);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("does not emit on a 429", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 5 } as never);
    expect((await call("ct=22&id=1&competitor_ids=1")).status).toBe(429);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("does not emit on an upstream 502", async () => {
    cachedExecuteQuery.mockRejectedValue(new Error("boom"));
    expect((await call("ct=22&id=1&competitor_ids=1")).status).toBe(502);
    expect(usageSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/live-grid-route-telemetry.test.ts`
Expected: first test FAILS (`usageSpy` called 0 times); the three negative tests pass.

- [ ] **Step 7: Emit in `app/api/live-grid/route.ts`** -- add to imports:

```ts
import { bucketGridRows, usageTelemetry } from "@/lib/usage-telemetry";
```

Immediately before the restricted early return (`if (!isComplete && matchData.event?.is_live_scores_accessible !== true) {` -> first line inside the block) add:

```ts
    usageTelemetry({
      op: "live-grid-view",
      ct: ctNum,
      rowsBucket: bucketGridRows(competitorIds.length),
      restricted: true,
    });
```

Immediately before the final `return NextResponse.json({ match_id: ..., cells, ... })` add:

```ts
  usageTelemetry({
    op: "live-grid-view",
    ct: ctNum,
    rowsBucket: bucketGridRows(competitorIds.length),
    restricted: scorecardsRestricted,
  });
```

- [ ] **Step 8: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/live-grid-route-telemetry.test.ts tests/unit/live-grid-route.test.ts tests/unit/usage-telemetry.test.ts`
Expected: PASS (all)

- [ ] **Step 9: Commit**

```bash
git add lib/usage-telemetry.ts app/api/live-grid/route.ts tests/unit/usage-telemetry.test.ts tests/unit/live-grid-route-telemetry.test.ts
git commit -m "feat(telemetry): emit live-grid-view usage event"
```

---

### Task 2: UI event schema and `POST /api/telemetry/ui`

**Files:**
- Create: `lib/ui-telemetry-schema.ts`
- Modify: `lib/usage-telemetry.ts` (new ops; move `bucketStageExportCompetitors`)
- Create: `app/api/telemetry/ui/route.ts`
- Modify: `docs/telemetry.md`, `app/legal/page.tsx` (Section 6, around line 188-219)
- Create: `tests/unit/ui-telemetry-schema.test.ts`, `tests/unit/telemetry-ui-route.test.ts`

**Interfaces:**
- Consumes: `usageTelemetry`, `UsageEvent` (Task 1 file); `checkRateLimit(req, {prefix, limit, windowSeconds})` from `lib/rate-limit.ts`.
- Produces:
  - `CHART_IDS = ["hf-by-stage", "hf-pct", "division-position", "speed-accuracy", "stage-balance"] as const`
  - `uiTelemetryEventSchema` (Zod discriminated union) and `type UiTelemetryEvent = z.infer<typeof uiTelemetryEventSchema>`
  - `bucketStageExportCompetitors(n: number): "1" | "2-4" | "5-12"` now defined in `lib/ui-telemetry-schema.ts`, re-exported unchanged from `lib/usage-telemetry.ts`
  - `UI_TELEMETRY_MAX_BYTES = 1024`
  - Endpoint: `POST /api/telemetry/ui`, body = one `UiTelemetryEvent` JSON; responses 204 / 400 / 413 / 429.

- [ ] **Step 1: Write failing schema tests** -- create `tests/unit/ui-telemetry-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bucketStageExportCompetitors,
  CHART_IDS,
  uiTelemetryEventSchema,
} from "@/lib/ui-telemetry-schema";

const ok = (v: unknown) => uiTelemetryEventSchema.safeParse(v).success;

describe("uiTelemetryEventSchema", () => {
  it("accepts every op", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "grid" })).toBe(true);
    expect(ok({ op: "analysis-section-open", ct: 22, section: "deep-dive" })).toBe(true);
    for (const chart of CHART_IDS) {
      expect(ok({ op: "chart-switch", ct: 22, chart })).toBe(true);
    }
    expect(ok({ op: "stage-export", ct: 22, surface: "ui", nCompetitorsBucket: "2-4" })).toBe(true);
  });

  it("rejects unknown ops", () => {
    expect(ok({ op: "match-view", ct: 22 })).toBe(false);
    expect(ok({ op: "anything", ct: 22 })).toBe(false);
  });

  it("rejects unknown enum values", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "settings" })).toBe(false);
    expect(ok({ op: "chart-switch", ct: 22, chart: "pie" })).toBe(false);
    expect(ok({ op: "stage-export", ct: 22, surface: "mcp", nCompetitorsBucket: "1" })).toBe(false);
  });

  it("rejects smuggled identifying fields instead of stripping them", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", shooterId: 5 })).toBe(false);
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", matchId: "123" })).toBe(false);
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", competitorIds: [1] })).toBe(false);
  });

  it("requires a positive integer ct", () => {
    expect(ok({ op: "tab-view", ct: 0, tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", ct: 2.5, tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", ct: "22", tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", tab: "grid" })).toBe(false);
  });
});

describe("bucketStageExportCompetitors", () => {
  it("buckets", () => {
    expect(bucketStageExportCompetitors(1)).toBe("1");
    expect(bucketStageExportCompetitors(0)).toBe("1");
    expect(bucketStageExportCompetitors(4)).toBe("2-4");
    expect(bucketStageExportCompetitors(12)).toBe("5-12");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/ui-telemetry-schema.test.ts`
Expected: FAIL -- cannot resolve `@/lib/ui-telemetry-schema`.

- [ ] **Step 3: Create `lib/ui-telemetry-schema.ts`**

```ts
// Client-safe: no server imports. Shared by the browser helper
// (lib/ui-telemetry.ts, type-only import) and POST /api/telemetry/ui.
//
// Every UI event carries `ct` plus enum values -- no match id, shooter id,
// competitor id, or free text (docs/telemetry.md "Privacy commitments").
// `.strict()` makes an unexpected field a rejection, not a silent strip, so
// a future call site cannot smuggle an identifier into the log.

import { z } from "zod";

export const UI_TELEMETRY_MAX_BYTES = 1024;

export const CHART_IDS = [
  "hf-by-stage",
  "hf-pct",
  "division-position",
  "speed-accuracy",
  "stage-balance",
] as const;

/** Bucket competitor count for stage-export usage events. Mirrors the
 *  scale used by mcp-telemetry's bucketCompetitors so dashboards can join
 *  on the same labels. */
export function bucketStageExportCompetitors(n: number): "1" | "2-4" | "5-12" {
  if (n <= 1) return "1";
  if (n <= 4) return "2-4";
  return "5-12";
}

const ct = z.number().int().positive();

export const uiTelemetryEventSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("tab-view"),
    ct,
    tab: z.enum(["grid", "info", "analysis"]),
  }).strict(),
  z.object({
    op: z.literal("analysis-section-open"),
    ct,
    section: z.enum(["charts", "deep-dive", "simulator"]),
  }).strict(),
  z.object({
    op: z.literal("chart-switch"),
    ct,
    chart: z.enum(CHART_IDS),
  }).strict(),
  z.object({
    op: z.literal("stage-export"),
    ct,
    surface: z.literal("ui"),
    nCompetitorsBucket: z.enum(["1", "2-4", "5-12"]),
  }).strict(),
]);

export type UiTelemetryEvent = z.infer<typeof uiTelemetryEventSchema>;
```

- [ ] **Step 4: Update `lib/usage-telemetry.ts`** -- delete the local `bucketStageExportCompetitors` function (and its doc comment) and replace with:

```ts
export { bucketStageExportCompetitors } from "@/lib/ui-telemetry-schema";
```

Update the `stage-export` variant comment from "surface:"ui" is reserved for a future client-side download tracker; not currently emitted." to "surface:"ui" arrives from the browser via POST /api/telemetry/ui." Add to the imports:

```ts
import type { UiTelemetryEvent } from "@/lib/ui-telemetry-schema";
```

Then add three variants to `UsageEvent` (after `live-grid-view`), derived from the schema so the two can never drift:

```ts
  // Browser-sent via POST /api/telemetry/ui (see lib/ui-telemetry-schema.ts).
  | Extract<UiTelemetryEvent, { op: "tab-view" }>
  | Extract<UiTelemetryEvent, { op: "analysis-section-open" }>
  | Extract<UiTelemetryEvent, { op: "chart-switch" }>
```

The existing `stage-export` variant stays as is (it also covers `surface: "mcp"`, and the UI shape is a subset of it).

- [ ] **Step 5: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/ui-telemetry-schema.test.ts tests/unit/usage-telemetry.test.ts && pnpm -w run typecheck`
Expected: PASS, zero type errors (confirms `mcp-tools.ts` still resolves `bucketStageExportCompetitors`).

- [ ] **Step 6: Write failing route tests** -- create `tests/unit/telemetry-ui-route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageSpy = vi.fn();
vi.mock("@/lib/usage-telemetry", () => ({ usageTelemetry: (ev: unknown) => usageSpy(ev) }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));

import { POST } from "@/app/api/telemetry/ui/route";

const post = (body: string) =>
  POST(new Request("http://localhost/api/telemetry/ui", {
    method: "POST",
    // sendBeacon with a string sends text/plain; the route must not care.
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body,
  }));

describe("POST /api/telemetry/ui", () => {
  beforeEach(() => {
    usageSpy.mockReset();
    rateLimit.mockReset().mockResolvedValue({ allowed: true });
  });

  it("forwards a valid event and returns 204", async () => {
    const ev = { op: "tab-view", ct: 22, tab: "analysis" };
    const res = await post(JSON.stringify(ev));
    expect(res.status).toBe(204);
    expect(usageSpy).toHaveBeenCalledWith(ev);
  });

  it("rate-limits under its own prefix", async () => {
    await post(JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" }));
    expect(rateLimit).toHaveBeenCalledWith(expect.any(Request), {
      prefix: "telemetry-ui", limit: 60, windowSeconds: 60,
    });
  });

  it("429s without logging when rate-limited", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 7 });
    const res = await post(JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" }));
    expect(res.status).toBe(429);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["empty body", ""],
    ["non-JSON", "not json"],
    ["JSON array", "[]"],
    ["unknown op", JSON.stringify({ op: "nope", ct: 22 })],
    ["smuggled id", JSON.stringify({ op: "tab-view", ct: 22, tab: "grid", shooterId: 1 })],
  ])("400s without logging: %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("413s an oversized body without parsing or logging", async () => {
    const res = await post("x".repeat(2048));
    expect(res.status).toBe(413);
    expect(usageSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/telemetry-ui-route.test.ts`
Expected: FAIL -- cannot resolve `@/app/api/telemetry/ui/route`.

- [ ] **Step 8: Create `app/api/telemetry/ui/route.ts`**

```ts
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  UI_TELEMETRY_MAX_BYTES,
  uiTelemetryEventSchema,
} from "@/lib/ui-telemetry-schema";
import { usageTelemetry } from "@/lib/usage-telemetry";

/**
 * POST /api/telemetry/ui
 *
 * Browser-sent UI interaction events (lib/ui-telemetry.ts, via sendBeacon).
 * Strict allowlist -- anything outside uiTelemetryEventSchema is a 400 and is
 * never logged. The rate limiter keys on IP in the cache only; the IP never
 * reaches the telemetry stream. Not reachable from MCP, so no maybeTagAsMcp.
 */
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, {
    prefix: "telemetry-ui",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const text = await req.text();
  if (text.length > UI_TELEMETRY_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = uiTelemetryEventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  usageTelemetry(parsed.data);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 9: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/telemetry-ui-route.test.ts`
Expected: PASS

- [ ] **Step 10: Document** -- in `docs/telemetry.md`, extend the `lib/usage-telemetry.ts` bullet (line 9) to:

```md
- `lib/usage-telemetry.ts` -- server-side product analytics (match views, comparisons, courtside grid views, searches, OG renders, dashboard views). Also receives browser-sent UI events (`tab-view`, `analysis-section-open`, `chart-switch`, `stage-export` with `surface:"ui"`) through `POST /api/telemetry/ui`, which validates against the strict allowlist in `lib/ui-telemetry-schema.ts` -- unknown ops or extra fields are rejected, never stripped. Client code calls `trackUi()` from `lib/ui-telemetry.ts`.
```

and under "Privacy commitments" add:

```md
- Browser-sent UI events carry `ct` plus enum values only -- no match id. Adding a field means extending `uiTelemetryEventSchema` (a reviewable change) and updating `/legal` Section 6.
```

In `app/legal/page.tsx` Section 6, add a third `<li>` after the "Recorded:" item:

```tsx
                <li>
                  <strong>Interaction events from your browser:</strong> which
                  match tab you open, which analysis sections and charts you
                  expand or switch to, and when you download a stage-time
                  export. These carry only the kind of match and the name of
                  the section -- no match, shooter or competitor identifiers.
                </li>
```

- [ ] **Step 11: Full checks and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test`
Expected: zero warnings, zero errors, all tests pass.

```bash
git add lib/ui-telemetry-schema.ts lib/usage-telemetry.ts app/api/telemetry/ui/route.ts docs/telemetry.md app/legal/page.tsx tests/unit/ui-telemetry-schema.test.ts tests/unit/telemetry-ui-route.test.ts
git commit -m "feat(telemetry): add allowlisted browser UI event endpoint"
```

---

### Task 3: `trackUi()` client helper and wiring

**Files:**
- Create: `lib/ui-telemetry.ts`
- Modify: `app/match/[ct]/[id]/match-page-client.tsx:1339` (coaching `Collapsible`), `:1476` (simulator `Collapsible`)
- Modify: `components/stage-times-export.tsx` (`onDownloadJson`, `onDownloadCsv`)
- Create: `tests/unit/ui-telemetry.test.ts`, `tests/components/stage-times-export.test.tsx`
- Modify: `tests/e2e/drawer-collapsible-toggle.spec.ts` ("coaching analysis expands on click" test)

**Interfaces:**
- Consumes: `type UiTelemetryEvent`, `bucketStageExportCompetitors` from `lib/ui-telemetry-schema.ts` (Task 2).
- Produces: `trackUi(ev: UiTelemetryEvent): void` -- PRs 2 and 3 call this for `tab-view`, `chart-switch`, `analysis-section-open: "charts"`.

- [ ] **Step 1: Write failing helper tests** -- create `tests/unit/ui-telemetry.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackUi } from "@/lib/ui-telemetry";

const EV = { op: "tab-view", ct: 22, tab: "grid" } as const;

describe("trackUi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the event as JSON via sendBeacon", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    trackUi(EV);
    expect(beacon).toHaveBeenCalledWith("/api/telemetry/ui", JSON.stringify(EV));
  });

  it("falls back to keepalive fetch when sendBeacon is missing", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchSpy);
    trackUi(EV);
    expect(fetchSpy).toHaveBeenCalledWith("/api/telemetry/ui", {
      method: "POST",
      body: JSON.stringify(EV),
      keepalive: true,
    });
  });

  it("falls back to fetch when sendBeacon refuses the payload", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchSpy);
    trackUi(EV);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws and never leaves an unhandled rejection", async () => {
    vi.stubGlobal("navigator", { sendBeacon: () => { throw new Error("blocked"); } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(() => trackUi(EV)).not.toThrow();
    // Let the rejected fetch promise settle; vitest fails the run on an
    // unhandled rejection.
    await new Promise((r) => setTimeout(r, 0));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/unit/ui-telemetry.test.ts`
Expected: FAIL -- cannot resolve `@/lib/ui-telemetry`.

- [ ] **Step 3: Create `lib/ui-telemetry.ts`**

```ts
// Client-safe. Fire-and-forget UI interaction telemetry; see
// lib/ui-telemetry-schema.ts for the allowlist and privacy rules.

import type { UiTelemetryEvent } from "@/lib/ui-telemetry-schema";

const ENDPOINT = "/api/telemetry/ui";

/** Record a UI interaction. Never throws: telemetry must not break the UI. */
export function trackUi(ev: UiTelemetryEvent): void {
  const body = JSON.stringify(ev);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, body)) return;
    }
  } catch {
    // Fall through to fetch.
  }
  try {
    fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // No fetch either -- drop the event.
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/unit/ui-telemetry.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing export-component test** -- create `tests/components/stage-times-export.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CompareResponse, MatchResponse } from "@/lib/types";

const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (ev: unknown) => trackUi(ev) }));
vi.mock("@/lib/stage-times-export", () => ({
  buildStageTimesExport: () => ({ match: { ct: "22", id: "1", name: "M" } }),
  buildStageTimesCsv: () => "a,b",
  stageTimesFilenameStem: () => "m",
}));

import { StageTimesExport } from "@/components/stage-times-export";

const match = { name: "M", competitors: [], squads: [] } as unknown as MatchResponse;
const compareData = {} as CompareResponse;

describe("StageTimesExport telemetry", () => {
  beforeEach(() => {
    trackUi.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it.each([["Download JSON"], ["Download CSV"]])("%s emits stage-export ui", (label) => {
    render(
      <StageTimesExport ct="22" id="1" match={match} compareData={compareData} selectedIds={[1, 2, 3]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(trackUi).toHaveBeenCalledWith({
      op: "stage-export", ct: 22, surface: "ui", nCompetitorsBucket: "2-4",
    });
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `pnpm -w exec vitest run tests/components/stage-times-export.test.tsx`
Expected: FAIL -- `trackUi` not called.

- [ ] **Step 7: Wire the export** -- in `components/stage-times-export.tsx` add imports:

```ts
import { trackUi } from "@/lib/ui-telemetry";
import { bucketStageExportCompetitors } from "@/lib/ui-telemetry-schema";
```

Add inside the component, after `buildExport`:

```ts
  const trackExport = () =>
    trackUi({
      op: "stage-export",
      ct: parseInt(ct, 10),
      surface: "ui",
      nCompetitorsBucket: bucketStageExportCompetitors(selectedIds.length),
    });
```

Call `trackExport();` as the last line of both `onDownloadJson` and `onDownloadCsv`.

- [ ] **Step 8: Run and confirm pass**

Run: `pnpm -w exec vitest run tests/components/stage-times-export.test.tsx`
Expected: PASS

- [ ] **Step 9: Write failing e2e assertion** -- in `tests/e2e/drawer-collapsible-toggle.spec.ts`, in the test "coaching analysis expands on click and reveals content region", before `page.goto(...)` add:

```ts
    const uiEvents: unknown[] = [];
    await page.route("**/api/telemetry/ui", async (route) => {
      uiEvents.push(JSON.parse(route.request().postData() ?? "null"));
      await route.fulfill({ status: 204 });
    });
```

and at the end of the test add:

```ts
    await expect.poll(() => uiEvents).toContainEqual({
      op: "analysis-section-open", ct: 22, section: "deep-dive",
    });

    // Closing must not emit -- only the closed->open transition counts.
    const before = uiEvents.length;
    await coachingBtn.click();
    await expect(coachingBtn).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(300);
    expect(uiEvents.length).toBe(before);
```

- [ ] **Step 10: Run and confirm failure**

Run: `SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/drawer-collapsible-toggle.spec.ts -g "coaching analysis expands" --reporter=line`
Expected: FAIL -- poll times out, `uiEvents` empty.

- [ ] **Step 11: Wire the collapsibles** -- in `app/match/[ct]/[id]/match-page-client.tsx` add `import { trackUi } from "@/lib/ui-telemetry";`. Near the other handlers (after the `setLiveView` callback around line 157-163) add:

```ts
  // Section-open telemetry counts only the closed->open transition.
  const onCoachingOpenChange = useCallback(
    (open: boolean) => {
      setShowCoachingView(open);
      if (open) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "deep-dive" });
      }
    },
    [ct],
  );
  const onSimulatorOpenChange = useCallback(
    (open: boolean) => {
      setShowSimulator(open);
      if (open) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "simulator" });
      }
    },
    [ct],
  );
```

(`useCallback` is already imported in this file; if not, add it to the `react` import.) Replace `onOpenChange={setShowCoachingView}` at line ~1339 with `onOpenChange={onCoachingOpenChange}` and `onOpenChange={setShowSimulator}` at line ~1476 with `onOpenChange={onSimulatorOpenChange}`.

Today's coaching collapsible maps to `deep-dive` because PR 3 folds exactly this content into the Deep dive section -- the baseline and post-restructure numbers line up.

- [ ] **Step 12: Run and confirm pass**

Run: `SSI_UPSTREAM_PAUSED=on pnpm exec playwright test tests/e2e/drawer-collapsible-toggle.spec.ts --reporter=line`
Expected: PASS (whole file)

- [ ] **Step 13: Full checks and commit**

Run: `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test && SSI_UPSTREAM_PAUSED=on pnpm test:e2e --reporter=line`
Expected: all green.

```bash
git add lib/ui-telemetry.ts components/stage-times-export.tsx "app/match/[ct]/[id]/match-page-client.tsx" tests/unit/ui-telemetry.test.ts tests/components/stage-times-export.test.tsx tests/e2e/drawer-collapsible-toggle.spec.ts
git commit -m "feat(telemetry): track deep-dive, simulator and export usage from the UI"
```

---

### Task 4: Open the PR

- [ ] **Step 1: Push and open**

```bash
git push -u origin feat/telemetry-ui-baseline
gh pr create --title "feat(telemetry): grid time-in-view and UI section usage baseline" --body-file ~/.claude-tmp/pr1-body.md
```

Write `~/.claude-tmp/pr1-body.md` first with these sections: **Why** (PR 1 of `docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md`; baseline before the restructure; grid usage is currently invisible), **What** (`live-grid-view` server event; `POST /api/telemetry/ui` with ops `tab-view`, `analysis-section-open`, `chart-switch`, `stage-export` surface ui; `trackUi()` wired to coaching, simulator, export), **Privacy** (strict allowlist, `ct` + enums only, extra fields rejected not stripped, IP only in the rate-limit cache key, `/legal` Section 6 updated), **Tests** (the commands from Task 3 Step 13 and their results). End with the Claude Code attribution footer.

- [ ] **Step 2: Release note** -- this PR ships on its own release (spec Section 4) so a match weekend of baseline lands before PR 2. No `RELEASES` entry: nothing user-visible beyond the legal text.
