import { test, expect } from "@playwright/test";
import type { MatchResponse, CompareResponse } from "@/lib/types";
import { LATEST_RELEASE_ID } from "@/lib/releases";

// ── Shared mock data ────────────────────────────────────────────────────────

const MOCK_MATCH: MatchResponse = {
  name: "Test IPSC Match",
  cacheInfo: { cachedAt: null },
  venue: "Test Range",
  lat: null,
  lng: null,
  date: "2026-03-01T09:00:00+00:00",
  level: "l2",
  sub_rule: "nm",
  discipline: "IPSC Handgun & PCC",
  region: "SWE",
  stages_count: 3,
  competitors_count: 10,
  scoring_completed: 100,
  match_status: "cp",
  results_status: "org",
  ssi_url: "https://shootnscoreit.com/event/22/99999999/",
  stages: [
    { id: 1, name: "Stage 1", stage_number: 1, max_points: 80, min_rounds: 16, paper_targets: 8, steel_targets: 0, ssi_url: "https://shootnscoreit.com/event/stage/24/1/", course_display: "Medium", procedure: null, firearm_condition: null },
    { id: 2, name: "Stage 2", stage_number: 2, max_points: 60, min_rounds: 12, paper_targets: 6, steel_targets: 0, ssi_url: "https://shootnscoreit.com/event/stage/24/2/", course_display: "Short", procedure: null, firearm_condition: null },
    { id: 3, name: "Stage 3", stage_number: 3, max_points: 100, min_rounds: null, paper_targets: null, steel_targets: null, ssi_url: null, course_display: null, procedure: null, firearm_condition: null },
  ],
  competitors: [
    { id: 100, shooterId: null, name: "Alice Archer", competitor_number: "35", club: "Test Club", division: "Standard", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 200, shooterId: null, name: "Bob Shooter", competitor_number: "50", club: "Test Club", division: "Standard", region: null, region_display: null, category: null, ics_alias: null, license: null },
  ],
  squads: [
    { id: 1, number: 1, name: "Squad 1", competitorIds: [100, 200] },
  ],
};

const MOCK_COMPARE: CompareResponse = {
  match_id: 99999999,
  mode: "coaching",
  cacheInfo: { cachedAt: null },
  competitors: [MOCK_MATCH.competitors[0], MOCK_MATCH.competitors[1]],
  penaltyStats: {
    100: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 61.7, matchPctClean: 61.7, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
    200: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 100, matchPctClean: 100, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
  },
  efficiencyStats: {},
  consistencyStats: {
    100: { coefficientOfVariation: null, label: null, stagesFired: 1 },
    200: { coefficientOfVariation: null, label: null, stagesFired: 1 },
  },
  lossBreakdownStats: {
    100: { totalHitLoss: 0, totalPenaltyLoss: 0, totalLoss: 0, stagesFired: 2, hasHitZoneData: false },
    200: { totalHitLoss: 0, totalPenaltyLoss: 0, totalLoss: 0, stagesFired: 2, hasHitZoneData: false },
  },
  whatIfStats: { 100: null, 200: null },
  styleFingerprintStats: {
    100: { alphaRatio: null, pointsPerSecond: null, penaltyRate: null, totalA: 0, totalC: 0, totalD: 0, totalPoints: 0, totalTime: 0, totalPenalties: 0, totalRounds: 0, stagesFired: 0, accuracyPercentile: null, speedPercentile: null, archetype: null, composurePercentile: 50, consistencyPercentile: 50 },
    200: { alphaRatio: null, pointsPerSecond: null, penaltyRate: null, totalA: 0, totalC: 0, totalD: 0, totalPoints: 0, totalTime: 0, totalPenalties: 0, totalRounds: 0, stagesFired: 0, accuracyPercentile: null, speedPercentile: null, archetype: null, composurePercentile: 50, consistencyPercentile: 50 },
  },
  fieldFingerprintPoints: [],
  archetypePerformance: {},
  courseLengthPerformance: {},
  constraintPerformance: {
    100: { normal: { stageCount: 2, avgGroupPercent: 61.7 }, constrained: { stageCount: 0, avgGroupPercent: null } },
    200: { normal: { stageCount: 2, avgGroupPercent: 100 }, constrained: { stageCount: 0, avgGroupPercent: null } },
  },
  stageDegradationData: null,
  stageConditions: null,
  stages: [
    {
      stage_id: 1, stage_name: "Stage 1", stage_num: 1, max_points: 80, course_display: "Medium",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      group_leader_hf: 5.73, group_leader_points: 76, overall_leader_hf: 5.73,
      field_median_hf: 4.0, field_median_accuracy: null, field_cv: null, field_competitor_count: 50,
      stageDifficultyLevel: 3, stageDifficultyLabel: "hard", stageSeparatorLevel: 2 as const,
      competitors: {
        100: { competitor_id: 100, points: 72, hit_factor: 5.02, time: 14.34, group_rank: 2, group_percent: 87.6, div_rank: 1, div_percent: 100, overall_rank: 2, overall_percent: 87.6, overall_percentile: 0.0, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
        200: { competitor_id: 200, points: 76, hit_factor: 5.63, time: 13.49, group_rank: 1, group_percent: 100, div_rank: 1, div_percent: 100, overall_rank: 1, overall_percent: 100, overall_percentile: 1.0, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
      },
    },
    {
      stage_id: 2, stage_name: "Stage 2", stage_num: 2, max_points: 60, course_display: "Short",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      group_leader_hf: 3.63, group_leader_points: 58, overall_leader_hf: 3.63,
      field_median_hf: 4.0, field_median_accuracy: null, field_cv: null, field_competitor_count: 50,
      stageDifficultyLevel: 3, stageDifficultyLabel: "hard", stageSeparatorLevel: 2 as const,
      competitors: {
        100: { competitor_id: 100, points: 26, hit_factor: 1.30, time: 20.0, group_rank: 2, group_percent: 35.8, div_rank: 2, div_percent: 35.8, overall_rank: 2, overall_percent: 35.8, overall_percentile: 0.0, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
        200: { competitor_id: 200, points: 58, hit_factor: 3.63, time: 15.98, group_rank: 1, group_percent: 100, div_rank: 1, div_percent: 100, overall_rank: 1, overall_percent: 100, overall_percentile: 1.0, dq: false, zeroed: false, dnf: false, incomplete: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null, stageClassification: null, hitLossPoints: null, penaltyLossPoints: 0 },
      },
    },
  ],
};

// ── Drawer tests ────────────────────────────────────────────────────────────

test.describe("Drawer — desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("My Shooters drawer has a drag handle", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: /my shooters/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // vaul renders a drag handle bar (bg-muted rounded-full) inside the drawer content
    await expect(page.locator("[data-slot='drawer-content'] .bg-muted.rounded-full")).toBeVisible();
  });

  test("My Shooters drawer closes on overlay click", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: /my shooters/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Click the overlay (fixed inset-0 element behind the drawer)
    await page.locator("[data-slot='drawer-overlay']").click({ force: true });
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("My Shooters drawer contains expected sections", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: /my shooters/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Find shooter" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Your identity" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /Tracked competitors/ })).toBeVisible();
  });
});

test.describe("Drawer — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("More drawer opens from bottom nav", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /more/i })
      .click();
    const dialog = page.getByRole("dialog", { name: /more/i });
    await expect(dialog).toBeVisible();
    // Verify drawer has drag handle bar
    await expect(page.locator("[data-slot='drawer-content'] .bg-muted.rounded-full")).toBeVisible();
  });

  test("Tracked shooters drawer opens from bottom nav", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /shooters/i })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("My shooters")).toBeVisible();
  });

  test("drawer has no horizontal overflow at 390px", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /shooters/i })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});

// ── Collapsible tests ───────────────────────────────────────────────────────

test.describe("Collapsible — coaching and simulator sections", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("coaching and simulator toggles use aria-expanded", async ({ page }) => {
    await page.route("/api/match/22/99999999", (route) =>
      route.fulfill({ json: MOCK_MATCH }),
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE }),
    );
    await page.route("/api/coaching/available", (route) =>
      route.fulfill({ json: { available: false } }),
    );

    await page.goto("/match/22/99999999?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    // Coaching analysis should start collapsed
    const coachingBtn = page.getByRole("button", { name: /coaching analysis/i });
    await expect(coachingBtn).toBeVisible();
    await expect(coachingBtn).toHaveAttribute("aria-expanded", "false");

    // Stage simulator should also start collapsed
    const simulatorBtn = page.getByRole("button", { name: /stage simulator/i });
    await expect(simulatorBtn).toBeVisible();
    await expect(simulatorBtn).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Collapsible — coaching analysis expand", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("coaching analysis expands on click and reveals content region", async ({ page }) => {
    await page.route("/api/match/22/99999999", (route) =>
      route.fulfill({ json: MOCK_MATCH }),
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE }),
    );
    await page.route("/api/coaching/available", (route) =>
      route.fulfill({ json: { available: false } }),
    );

    await page.goto("/match/22/99999999?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    const coachingBtn = page.getByRole("button", { name: /coaching analysis/i });
    await expect(coachingBtn).toHaveAttribute("aria-expanded", "false");
    await coachingBtn.click();
    await expect(coachingBtn).toHaveAttribute("aria-expanded", "true");

    // Coaching content region should appear
    await expect(
      page.locator("[aria-labelledby='coaching-view-heading']"),
    ).toBeVisible();
  });
});

// ── ToggleGroup tests ───────────────────────────────────────────────────────

test.describe("ToggleGroup — comparison table view mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("view mode toggle renders as radio group with Absolute selected", async ({ page }) => {
    await page.route("/api/match/22/99999999", (route) =>
      route.fulfill({ json: MOCK_MATCH }),
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE }),
    );

    await page.goto("/match/22/99999999?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    const absoluteRadio = page.getByRole("radio", { name: "Absolute" });
    const deltaRadio = page.getByRole("radio", { name: "Delta" });
    await expect(absoluteRadio).toBeVisible();
    await expect(deltaRadio).toBeVisible();
    await expect(absoluteRadio).toHaveAttribute("aria-checked", "true");
    await expect(deltaRadio).toHaveAttribute("aria-checked", "false");
  });

  test("clicking Delta switches view mode", async ({ page }) => {
    await page.route("/api/match/22/99999999", (route) =>
      route.fulfill({ json: MOCK_MATCH }),
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE }),
    );

    await page.goto("/match/22/99999999?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    await page.getByRole("radio", { name: "Delta" }).click();
    await expect(page.getByRole("radio", { name: "Delta" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Absolute" })).toHaveAttribute("aria-checked", "false");
    // Delta mode should show deficit labels
    await expect(page.getByText("Total deficit")).toBeVisible();
  });

  test("arrow keys navigate between toggle items", async ({ page }) => {
    await page.route("/api/match/22/99999999", (route) =>
      route.fulfill({ json: MOCK_MATCH }),
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE }),
    );

    await page.goto("/match/22/99999999?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    // Focus the Absolute radio
    const absoluteRadio = page.getByRole("radio", { name: "Absolute" });
    await absoluteRadio.focus();

    // Arrow right should move focus to Delta
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Delta" })).toBeFocused();
  });
});

test.describe("ToggleGroup — event search filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("filter chips render as radio groups", async ({ page }) => {
    await page.goto("/");

    // Open filters
    const filterBtn = page.getByRole("button", { name: /filters/i });
    await expect(filterBtn).toBeVisible();
    await filterBtn.click();

    // Each filter category should have a radio group
    await expect(page.getByRole("group", { name: "Discipline" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Country" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Level" })).toBeVisible();
  });

  test("clicking a filter chip selects it", async ({ page }) => {
    await page.route("/api/events**", (route) =>
      route.fulfill({ json: [] }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: /filters/i }).click();

    // Click L3+ level filter
    const l3Radio = page.getByRole("radio", { name: "L3+" });
    await l3Radio.click();
    await expect(l3Radio).toHaveAttribute("aria-checked", "true");

    // "All" level should now be unchecked
    const allLevel = page.getByRole("group", { name: "Level" }).getByRole("radio", { name: "All" });
    await expect(allLevel).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("ToggleGroup — mobile overflow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((releaseId) => {
      localStorage.setItem("ssi-cell-help-seen", "1");
      localStorage.setItem("whats-new-seen-id", releaseId);
    }, LATEST_RELEASE_ID);
  });

  test("filter toggle groups have no horizontal overflow at 390px", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByRole("group", { name: "Discipline" })).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
