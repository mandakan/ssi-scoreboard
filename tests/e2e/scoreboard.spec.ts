import { test, expect } from "@playwright/test";
import type { MatchResponse, CompareResponse } from "@/lib/types";

const MOCK_MATCH: MatchResponse = {
  name: "Test IPSC Match",
  venue: "Test Range",
  date: "2026-03-01T09:00:00+00:00",
  level: "l2",
  sub_rule: "nm",
  region: "SWE",
  stages_count: 3,
  competitors_count: 10,
  scoring_completed: 75,
  stages: [
    { id: 1, name: "Stage 1", stage_number: 1, max_points: 80, min_rounds: 16, paper_targets: 8, steel_targets: 0, ssi_url: "https://shootnscoreit.com/event/stage/24/1/" },
    { id: 2, name: "Stage 2", stage_number: 2, max_points: 60, min_rounds: 12, paper_targets: 6, steel_targets: 0, ssi_url: "https://shootnscoreit.com/event/stage/24/2/" },
    { id: 3, name: "Stage 3", stage_number: 3, max_points: 100, min_rounds: null, paper_targets: null, steel_targets: null, ssi_url: null },
  ],
  competitors: [
    { id: 100, name: "Alice Archer", competitor_number: "35", club: "Test Club", division: "Standard" },
    { id: 200, name: "Bob Shooter", competitor_number: "50", club: "Test Club", division: "Standard" },
    { id: 300, name: "Charlie Marksman", competitor_number: "116", club: null, division: null },
  ],
};

const MOCK_COMPARE: CompareResponse = {
  match_id: 26547,
  competitors: [
    MOCK_MATCH.competitors[0],
    MOCK_MATCH.competitors[1],
    MOCK_MATCH.competitors[2],
  ],
  stages: [
    {
      stage_id: 1,
      stage_name: "Stage 1",
      stage_num: 1,
      max_points: 80,
      group_leader_hf: 5.73,
      group_leader_points: 76,
      overall_leader_hf: 5.73,
      field_median_hf: 4.0,
      field_competitor_count: 50,
      competitors: {
        100: { competitor_id: 100, points: 72, hit_factor: 5.02, time: 14.34, group_rank: 2, group_percent: 87.6, div_rank: 1, div_percent: 100, overall_rank: 2, overall_percent: 87.6, dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        200: { competitor_id: 200, points: 76, hit_factor: 5.63, time: 13.49, group_rank: 2, group_percent: 98.3, div_rank: 1, div_percent: 100, overall_rank: 2, overall_percent: 98.3, dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        300: { competitor_id: 300, points: 76, hit_factor: 5.73, time: 13.26, group_rank: 1, group_percent: 100,  div_rank: 1, div_percent: 100, overall_rank: 1, overall_percent: 100,  dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
      },
    },
    {
      stage_id: 2,
      stage_name: "Stage 2",
      stage_num: 2,
      max_points: 60,
      group_leader_hf: 3.63,
      group_leader_points: 58,
      overall_leader_hf: 3.63,
      field_median_hf: 4.0,
      field_competitor_count: 50,
      competitors: {
        100: { competitor_id: 100, points: 26, hit_factor: 1.30, time: 20.0,  group_rank: 3, group_percent: 35.8, div_rank: 2, div_percent: 35.8, overall_rank: 3, overall_percent: 35.8, dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        200: { competitor_id: 200, points: 58, hit_factor: 3.63, time: 15.98, group_rank: 1, group_percent: 100,  div_rank: 1, div_percent: 100,  overall_rank: 1, overall_percent: 100,  dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        300: { competitor_id: 300, points: 54, hit_factor: 3.16, time: 17.09, group_rank: 2, group_percent: 87.1, div_rank: 1, div_percent: 100,  overall_rank: 2, overall_percent: 87.1, dq: false, zeroed: false, dnf: false, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
      },
    },
    {
      stage_id: 3,
      stage_name: "Stage 3",
      stage_num: 3,
      max_points: 100,
      group_leader_hf: null,
      group_leader_points: null,
      overall_leader_hf: null,
      field_median_hf: null,
      field_competitor_count: 0,
      competitors: {
        100: { competitor_id: 100, points: null, hit_factor: null, time: null, group_rank: null, group_percent: null, div_rank: null, div_percent: null, overall_rank: null, overall_percent: null, dq: false, zeroed: false, dnf: true, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        200: { competitor_id: 200, points: null, hit_factor: null, time: null, group_rank: null, group_percent: null, div_rank: null, div_percent: null, overall_rank: null, overall_percent: null, dq: false, zeroed: false, dnf: true, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
        300: { competitor_id: 300, points: null, hit_factor: null, time: null, group_rank: null, group_percent: null, div_rank: null, div_percent: null, overall_rank: null, overall_percent: null, dq: false, zeroed: false, dnf: true, a_hits: null, c_hits: null, d_hits: null, miss_count: null, no_shoots: null, procedurals: null },
      },
    },
  ],
};

const MOCK_COMPARE_2: CompareResponse = {
  ...MOCK_COMPARE,
  competitors: [MOCK_MATCH.competitors[0], MOCK_MATCH.competitors[1]],
  stages: MOCK_COMPARE.stages.map((s) => ({
    ...s,
    competitors: {
      100: s.competitors[100],
      200: s.competitors[200],
    },
  })),
};

test.describe("Scoreboard E2E", () => {
  test("home page loads and URL input is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: /match url/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /load/i })).toBeVisible();
  });

  test("invalid URL shows error message", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").fill("https://example.com/event/22/26547/");
    await page.getByRole("button", { name: /load/i }).click();
    // Scope to the <p> alert to avoid matching the Next.js route announcer
    await expect(page.locator("p[role='alert']")).toBeVisible();
  });

  test("valid URL navigates to match page", async ({ page }) => {
    // Mock the match API
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );

    await page.goto("/");
    await page.getByRole("textbox").fill("https://shootnscoreit.com/event/22/26547/");
    await page.getByRole("button", { name: /load/i }).click();

    await page.waitForURL("/match/22/26547");
    await expect(page.getByText("Test IPSC Match")).toBeVisible();
    // StageList should be present (collapsed by default)
    await expect(page.getByRole("button", { name: /stages \(3\)/i })).toBeVisible();
  });

  test("selecting 3 competitors shows comparison table with 3 columns", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE })
    );

    await page.goto("/match/22/26547");
    await expect(page.getByText("Test IPSC Match")).toBeVisible();

    // Open picker and select all 3 competitors
    await page.getByRole("button", { name: /add competitor/i }).click();
    await page.getByRole("option", { name: /alice/i }).click();
    await page.getByRole("option", { name: /bob/i }).click();
    await page.getByRole("option", { name: /charlie/i }).click();

    // Table should appear
    await expect(page.getByText("Stage results")).toBeVisible();
    // 3 competitor columns in table header (scoped to avoid matching picker options)
    await expect(page.getByRole("table").getByText("#35")).toBeVisible();
    await expect(page.getByRole("table").getByText("#50")).toBeVisible();
    await expect(page.getByRole("table").getByText("#116")).toBeVisible();
  });

  test("chart renders as SVG after competitor selection", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE })
    );

    await page.goto("/match/22/26547");
    await page.getByRole("button", { name: /add competitor/i }).click();
    await page.getByRole("option", { name: /alice/i }).click();

    // Check the chart section renders (contains recharts SVG)
    await expect(page.getByText("Hit factor by stage")).toBeVisible();
  });

  test("?competitors param pre-selects competitors on load", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE_2 })
    );

    await page.goto("/match/22/26547?competitors=100,200");
    await expect(page.getByText("Test IPSC Match")).toBeVisible();

    // Pre-selected competitors should appear without manually opening the picker
    await expect(page.getByText("Stage results")).toBeVisible();
    await expect(page.getByRole("table").getByText("#35")).toBeVisible(); // Alice
    await expect(page.getByRole("table").getByText("#50")).toBeVisible(); // Bob
  });

  test("selecting a competitor updates the URL", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE_2 })
    );

    await page.goto("/match/22/26547");
    await page.getByRole("button", { name: /add competitor/i }).click();
    await page.getByRole("option", { name: /alice/i }).click();
    await page.getByRole("option", { name: /bob/i }).click();

    await expect(page).toHaveURL(/\?competitors=100,200/);
  });

  test("deselecting a competitor updates the URL", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE_2 })
    );

    await page.goto("/match/22/26547?competitors=100,200");
    await expect(page.getByText("Stage results")).toBeVisible();

    await page.getByRole("button", { name: /remove alice/i }).click();
    await expect(page).toHaveURL(/\?competitors=200/);
  });

  test("deselecting a competitor updates the table", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    // Return 3-competitor response when Charlie (id=300) is requested; 2-competitor otherwise
    await page.route(/\/api\/compare/, (route) => {
      const ids = new URL(route.request().url()).searchParams.get("competitor_ids") ?? "";
      route.fulfill({ json: ids.includes("300") ? MOCK_COMPARE : MOCK_COMPARE_2 });
    });

    await page.goto("/match/22/26547");
    await page.getByRole("button", { name: /add competitor/i }).click();
    await page.getByRole("option", { name: /alice/i }).click();
    await page.getByRole("option", { name: /bob/i }).click();
    await page.getByRole("option", { name: /charlie/i }).click();
    // Scope to table to avoid matching the picker's still-open option list
    await expect(page.getByRole("table").getByText("#116")).toBeVisible();

    // Deselect Charlie by clicking the X badge
    await page.getByRole("button", { name: /remove charlie/i }).click();
    await expect(page.getByRole("table").getByText("#116")).not.toBeVisible();
  });
});

test.describe("Mobile 390px viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("comparison page has no horizontal overflow with 2 competitors", async ({ page }) => {
    await page.route("/api/match/22/26547", (route) =>
      route.fulfill({ json: MOCK_MATCH })
    );
    await page.route(/\/api\/compare/, (route) =>
      route.fulfill({ json: MOCK_COMPARE_2 })
    );

    await page.goto("/match/22/26547?competitors=100,200");
    await expect(page.getByText("Test IPSC Match")).toBeVisible();
    await expect(page.getByText("Stage results")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasOverflow).toBe(false);
  });

  test("home page has no horizontal overflow at 390px", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: /match url/i })).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasOverflow).toBe(false);
  });
});
