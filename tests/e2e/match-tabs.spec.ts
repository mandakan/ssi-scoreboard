import { test, expect, type Page } from "@playwright/test";
import type { CompareResponse, MatchResponse } from "@/lib/types";
import { LATEST_RELEASE_ID } from "@/lib/releases";

// 390px -- iPhone 14, the primary breakpoint per CLAUDE.md.
test.use({ viewport: { width: 390, height: 844 } });

const STAGE_COUNT = 12;
const SHOOTER_COUNT = 8;

const STAGES = Array.from({ length: STAGE_COUNT }, (_, i) => ({
  id: i + 1,
  name: `Stage ${i + 1}`,
  stage_number: i + 1,
  max_points: 60,
  min_rounds: 12,
  paper_targets: 6,
  steel_targets: 0,
  ssi_url: null,
  course_display: "Medium",
  procedure: null,
  firearm_condition: null,
}));

const COMPETITORS = Array.from({ length: SHOOTER_COUNT }, (_, i) => ({
  id: 100 + i,
  shooterId: 500 + i,
  name: `Shooter ${i + 1} Lastname`,
  competitor_number: String(10 + i),
  club: "Test Club",
  division: "Production",
  region: null,
  region_display: null,
  category: null,
  ics_alias: null,
  license: null,
}));

const MOCK_MATCH: MatchResponse = {
  name: "Live Grid Test Match",
  cacheInfo: { cachedAt: null },
  venue: "Test Range",
  lat: null,
  lng: null,
  date: new Date().toISOString(),
  level: "l2",
  sub_rule: "nm",
  discipline: "IPSC Handgun & PCC",
  region: "SWE",
  stages_count: STAGE_COUNT,
  competitors_count: SHOOTER_COUNT,
  scoring_pct: 50,
  match_status: "on",
  results_status: "stg",
  is_live_scores_accessible: true,
  registration_status: "cl",
  registration_starts: null,
  registration_closes: null,
  is_registration_possible: false,
  squadding_starts: null,
  squadding_closes: null,
  is_squadding_possible: false,
  max_competitors: null,
  ends: null,
  ssi_url: "https://shootnscoreit.com/event/22/88888888/",
  visibility: {
    class: "public",
    rawCode: "pub",
    displayName: "Public, searchable and details/names for all",
  },
  access_reason: { kind: "public", rawVisibility: "pub", role: null },
  role_names: [],
  organizer: null,
  stages: STAGES,
  competitors: COMPETITORS,
  squads: [
    {
      id: 1,
      number: 4,
      name: "Squad 4",
      competitorIds: COMPETITORS.map((c) => c.id),
    },
  ],
};

const MOCK_COMPARE: CompareResponse = {
  match_id: 88888888,
  mode: "coaching",
  cacheInfo: { cachedAt: null },
  competitors: [COMPETITORS[0], COMPETITORS[1]],
  penaltyStats: {
    100: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 90, matchPctClean: 90, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
    101: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 90, matchPctClean: 90, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
  },
  efficiencyStats: {},
  consistencyStats: {
    100: { coefficientOfVariation: null, label: null, stagesFired: 2 },
    101: { coefficientOfVariation: null, label: null, stagesFired: 2 },
  },
  lossBreakdownStats: {
    100: { totalHitLoss: 0, totalPenaltyLoss: 0, totalLoss: 0, stagesFired: 2, hasHitZoneData: false },
    101: { totalHitLoss: 0, totalPenaltyLoss: 0, totalLoss: 0, stagesFired: 2, hasHitZoneData: false },
  },
  whatIfStats: { 100: null, 101: null },
  styleFingerprintStats: {
    100: { alphaRatio: null, pointsPerSecond: null, penaltyRate: null, totalA: 0, totalC: 0, totalD: 0, totalPoints: 0, totalTime: 0, totalPenalties: 0, totalRounds: 0, stagesFired: 0, accuracyPercentile: null, speedPercentile: null, archetype: null, composurePercentile: 50, consistencyPercentile: 50 },
    101: { alphaRatio: null, pointsPerSecond: null, penaltyRate: null, totalA: 0, totalC: 0, totalD: 0, totalPoints: 0, totalTime: 0, totalPenalties: 0, totalRounds: 0, stagesFired: 0, accuracyPercentile: null, speedPercentile: null, archetype: null, composurePercentile: 50, consistencyPercentile: 50 },
  },
  fieldFingerprintPoints: [],
  archetypePerformance: {},
  courseLengthPerformance: {},
  constraintPerformance: {
    100: { normal: { stageCount: 2, avgGroupPercent: 90 }, constrained: { stageCount: 0, avgGroupPercent: null } },
    101: { normal: { stageCount: 2, avgGroupPercent: 90 }, constrained: { stageCount: 0, avgGroupPercent: null } },
  },
  stageDegradationData: null,
  stageConditions: null,
  stages: [
    {
      stage_id: 1, stage_name: "Stage 1", stage_num: 1, max_points: 60, course_display: "Medium",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      group_leader_hf: 5, group_leader_points: 55, overall_leader_hf: 5,
      field_median_hf: 4, field_median_accuracy: null, field_cv: null, field_competitor_count: 8,
      stageDifficultyLevel: 3, stageDifficultyLabel: "hard", stageSeparatorLevel: 2 as const,
      competitors: {
        100: { competitor_id: 100, points: 50, hit_factor: 4.5, time: 11.1, group_rank: 2, group_percent: 90, div_rank: 2, div_percent: 90, overall_rank: 2, overall_percent: 90, overall_percentile: 0.5, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
        101: { competitor_id: 101, points: 55, hit_factor: 5, time: 11, group_rank: 1, group_percent: 100, div_rank: 1, div_percent: 100, overall_rank: 1, overall_percent: 100, overall_percentile: 0.5, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
      },
    },
    {
      stage_id: 2, stage_name: "Stage 2", stage_num: 2, max_points: 60, course_display: "Medium",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      group_leader_hf: 5, group_leader_points: 55, overall_leader_hf: 5,
      field_median_hf: 4, field_median_accuracy: null, field_cv: null, field_competitor_count: 8,
      stageDifficultyLevel: 3, stageDifficultyLabel: "hard", stageSeparatorLevel: 2 as const,
      competitors: {
        100: { competitor_id: 100, points: 50, hit_factor: 4.5, time: 11.1, group_rank: 2, group_percent: 90, div_rank: 2, div_percent: 90, overall_rank: 2, overall_percent: 90, overall_percentile: 0.5, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
        101: { competitor_id: 101, points: 55, hit_factor: 5, time: 11, group_rank: 1, group_percent: 100, div_rank: 1, div_percent: 100, overall_rank: 1, overall_percent: 100, overall_percentile: 0.5, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
      },
    },
  ],
};

async function mockApis(page: Page, match: MatchResponse = MOCK_MATCH) {
  await page.route("**/api/match/**", (route) =>
    route.fulfill({ json: match }),
  );
  // Everything else the page pulls in -- keep it quiet so the test is about
  // the tab, not the surrounding chrome.
  await page.route("**/api/upstream-status**", (route) =>
    route.fulfill({ json: { degraded: false, paused: false } }),
  );
  await page.route("**/api/coaching/availability**", (route) =>
    route.fulfill({ json: { available: false } }),
  );
}

async function suppressDialogs(page: Page) {
  // Suppress the first-visit dialogs -- their overlay intercepts pointer events.
  await page.addInitScript((releaseId) => {
    localStorage.setItem("ssi-cell-help-seen", "1");
    localStorage.setItem("whats-new-seen-id", releaseId);
  }, LATEST_RELEASE_ID);
}

// Asserts document order: match heading, then (optionally) the results
// disclaimer, then "Your squad", then "Stage rotation".
async function expectInfoOrder(page: Page, { disclaimer }: { disclaimer: boolean }) {
  const squad = page.getByRole("heading", { name: /your squad/i });
  await expect(squad).toBeVisible();
  const ordered = await page.evaluate((withDisclaimer) => {
    const match = document.querySelector("main h1");
    const alert = withDisclaimer
      ? Array.from(document.querySelectorAll('[role="alert"]')).find((e) => /results are not yet/i.test(e.textContent ?? "")) ?? null
      : null;
    const h2s = Array.from(document.querySelectorAll("h2"));
    const sq = h2s.find((h) => /your squad/i.test(h.textContent ?? "")) ?? null;
    const rot = h2s.find((h) => /stage rotation/i.test(h.textContent ?? "")) ?? null;
    if (!match || (withDisclaimer && !alert) || !sq || !rot) return false;
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before(match, sq) && (!alert || (before(match, alert) && before(alert, sq))) && before(sq, rot);
  }, disclaimer);
  expect(ordered).toBe(true);
}

test.describe("match tabs", () => {
  test("info tab shows the match header and squad rotation", async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page);
    await page.goto("/match/22/88888888/info");
    await expect(page.getByRole("heading", { name: "Live Grid Test Match" })).toBeVisible();
    await expect(page.getByText(/results are not yet officially published/i)).toBeVisible();
    await expectInfoOrder(page, { disclaimer: true });
  });

  test("info tab for a completed match has no disclaimer but keeps the sections", async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page, { ...MOCK_MATCH, match_status: "cp", results_status: "all" });
    await page.goto("/match/22/88888888/info");
    await expect(page.getByRole("heading", { name: "Live Grid Test Match" })).toBeVisible();
    await expect(page.getByText(/results are not yet officially published/i)).toHaveCount(0);
    await expectInfoOrder(page, { disclaimer: false });
    await expect(page.getByRole("heading", { name: /stage rotation/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^registered field/i })).toHaveAttribute("aria-expanded", "false");
  });
});

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

async function openPreMatchGrid(page: Page) {
  await suppressDialogs(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "ssi-my-shooter",
      JSON.stringify({ shooterId: 500, name: "Shooter 1 Lastname", license: null }),
    );
  });
  await page.route("**/api/match/**", (r) =>
    r.fulfill({ json: { ...MOCK_MATCH, scoring_pct: 0, date: new Date().toISOString() } }));
  await page.route("**/api/upstream-status**", (r) =>
    r.fulfill({ json: { degraded: false, paused: false } }));
  await page.route("**/api/pre-match/weather**", (r) =>
    r.fulfill({ json: { available: false, reason: "no_coordinates" } }));
  const calls = { grid: 0, compare: 0 };
  await page.route("**/api/live-grid**", (r) => {
    calls.grid++;
    return r.fulfill({ json: { stages: [], shooters: [], cells: {} } });
  });
  await page.route("**/api/compare**", (r) => {
    calls.compare++;
    return r.fulfill({ json: MOCK_COMPARE });
  });
  await page.goto("/match/22/88888888");
  return calls;
}

test("pre-match grid draws from the match and never fetches until the user opts in", async ({ page }) => {
  const calls = await openPreMatchGrid(page);
  await expect(page.getByRole("columnheader", { name: "S1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show live scores" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls.grid).toBe(0);
  expect(calls.compare).toBe(0);
  await page.getByRole("button", { name: "Show live scores" }).click();
  await expect.poll(() => calls.grid).toBeGreaterThan(0);
  expect(calls.compare).toBe(0);
});

test("tapping a pre-match cell opens the detail sheet with Not shot yet", async ({ page }) => {
  const calls = await openPreMatchGrid(page);
  await page.getByRole("button", { name: "Shooter 1 Lastname, stage 1", exact: true }).click();
  await expect(page.getByText("Not shot yet.")).toBeVisible();
  expect(calls.grid).toBe(0);
  expect(calls.compare).toBe(0);
});

test("tab switches keep one match fetch and hide the global nav", async ({ page }) => {
  await suppressDialogs(page);
  let matchFetches = 0;
  await page.route("**/api/match/**", (r) => {
    matchFetches++;
    return r.fulfill({ json: MOCK_MATCH });
  });
  await page.route("**/api/live-grid**", (r) =>
    r.fulfill({ json: { shooters: [], stages: [], cells: {} } }),
  );
  await page.goto("/match/22/88888888/info");
  const tabs = page.getByRole("navigation", { name: "Match sections" });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await tabs.getByRole("link", { name: /analysis/i }).click();
  await expect(page).toHaveURL(/\/analysis/);
  // dispatchEvent: under `next dev` the Next.js issues badge (bottom-left) can
  // sit on top of the Grid tab and swallow a pointer click. Dev-only.
  await tabs.getByRole("link", { name: /grid/i }).dispatchEvent("click");
  await expect(page).toHaveURL(/\/match\/22\/88888888$/);
  await tabs.getByRole("link", { name: /info/i }).click();
  await expect(page).toHaveURL(/\/info$/);
  expect(matchFetches).toBeLessThanOrEqual(1);
});

for (const path of ["", "/info", "/analysis"]) {
  test(`no horizontal overflow at 390px on ${path || "/"}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
  const nav = page.getByRole("navigation", { name: "Match sections" });
  await expect(nav).toBeVisible();
  const heights = await nav
    .getByRole("link")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights).toHaveLength(3);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});

test("analysis sections appear in spec order without horizontal overflow", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.route(/\/api\/compare/, (r) => r.fulfill({ json: MOCK_COMPARE }));
  await page.goto("/match/22/88888888/analysis?competitors=100,101");
  // Wait for the compare-driven sections so order and overflow run on rendered content.
  await expect(page.locator("main h2", { hasText: /Hit factor by stage/ })).toBeVisible();
  await expect(page.locator("main h2", { hasText: /Deep dive/ })).toBeVisible();
  const order = await page.locator("main h2").allTextContents();
  const idx = (re: RegExp) => order.findIndex((t) => re.test(t));
  expect(idx(/Stage results/)).toBeGreaterThanOrEqual(0);
  expect(idx(/Stage results/)).toBeLessThan(idx(/Hit factor by stage/));
  expect(idx(/Hit factor by stage/)).toBeLessThan(idx(/Deep dive/));
  // Selection bar summary precedes Stage results. (Focus areas are identity-gated
  // and not present in this fixture, so they are not asserted here.)
  const barFirst = await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll("main button")).find((b) =>
      /comparing:|choose shooters/i.test(b.textContent ?? ""),
    );
    const heading = Array.from(document.querySelectorAll("main h2")).find((h) =>
      /Stage results/.test(h.textContent ?? ""),
    );
    if (!bar || !heading) return false;
    return !!(bar.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(barFirst).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

// UpdateBanner only appears after a build-id mismatch from a 60s poll (and needs
// NEXT_PUBLIC_BUILD_ID, unset under `next dev`), so it cannot be forced here.
// InstallBanner shares the same offset classes and is driven by beforeinstallprompt.
test("install banner sits above the match tab bar", async ({ page }) => {
  await suppressDialogs(page);
  await mockApis(page);
  await page.goto("/match/22/88888888/info");
  const nav = page.getByRole("navigation", { name: "Match sections" });
  await expect(nav).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: /install ssi scoreboard/i });
  // The provider attaches its listener after hydration, so re-fire until it lands.
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })),
    );
    await expect(banner).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  const bannerBottom = await banner.evaluate((e) => e.getBoundingClientRect().bottom);
  const navTop = await nav.evaluate((e) => e.getBoundingClientRect().top);
  // 1px tolerance: the bar's border-t sits outside its h-14, so the banner
  // (offset 3.5rem) covers that hairline. Anything more is a real overlap.
  expect(bannerBottom).toBeLessThanOrEqual(navTop + 1);
});

test.describe("desktop 1280x900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("tabs are a top strip and the grid tab does not scroll the page", async ({ page }) => {
    await openPreMatchGrid(page);
    const nav = page.getByRole("navigation", { name: "Match sections" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "S1", exact: true })).toBeVisible();
    await expect(page.locator('nav[aria-label="Match sections"]')).toHaveCount(1);
    const box = await nav.boundingBox();
    expect(box!.y).toBeLessThan(200);
    const heights = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    expect(heights.scrollH).toBeLessThanOrEqual(heights.innerH);
  });

  test("analysis tab strip is also at the top", async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page);
    await page.goto("/match/22/88888888/analysis");
    const nav = page.getByRole("navigation", { name: "Match sections" });
    await expect(nav).toBeVisible();
    await expect(page.locator('nav[aria-label="Match sections"]')).toHaveCount(1);
    expect((await nav.boundingBox())!.y).toBeLessThan(200);
  });

  test("install banner does not cover the top tab strip", async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page);
    await page.goto("/match/22/88888888/info");
    const nav = page.getByRole("navigation", { name: "Match sections" });
    await expect(nav).toBeVisible();
    const banner = page.getByRole("status").filter({ hasText: /install ssi scoreboard/i });
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })),
      );
      await expect(banner).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    const b = (await banner.boundingBox())!;
    const n = (await nav.boundingBox())!;
    const overlap = b.y < n.y + n.height && b.y + b.height > n.y;
    expect(overlap).toBe(false);
  });
});
