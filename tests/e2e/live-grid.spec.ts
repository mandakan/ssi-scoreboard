import { test, expect, type Page } from "@playwright/test";
import type { LiveGridResponse, MatchResponse } from "@/lib/types";
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

const MOCK_GRID: LiveGridResponse = {
  match_id: 88888888,
  stages: STAGES.map((s) => ({
    stage_id: s.id,
    stage_num: s.stage_number,
    name: s.name,
    max_points: s.max_points,
  })),
  shooters: COMPETITORS.map((c) => ({
    id: c.id,
    shooterId: c.shooterId,
    name: c.name,
    competitor_number: c.competitor_number,
    division: c.division,
    squad: "4",
  })),
  cells: Object.fromEntries(
    COMPETITORS.map((c, ci) => [
      c.id,
      Object.fromEntries(
        // Stages 1-6 shot, 7-12 pending.
        STAGES.slice(0, 6).map((s, si) => [
          s.id,
          {
            hf: 5 + ((ci + si) % 5) * 0.3,
            time: 14 + ((ci * si) % 7),
            points: 50 + ((ci + si) % 10),
            a: 10 - (si % 3),
            c: si % 3,
            d: 0,
            m: si === 4 ? 1 : 0,
            ns: si === 5 ? 1 : 0,
            p: 0,
            status: "scored" as const,
            created: `2026-08-23T0${si + 3}:00:00Z`,
          },
        ]),
      ),
    ]),
  ),
  cacheInfo: { cachedAt: null },
};

async function mockApis(page: Page) {
  await page.route("**/api/match/**", (route) =>
    route.fulfill({ json: MOCK_MATCH }),
  );
  await page.route("**/api/live-grid**", (route) =>
    route.fulfill({ json: MOCK_GRID }),
  );
  // Everything else the page pulls in -- keep it quiet so the test is about
  // the grid, not the surrounding chrome.
  await page.route("**/api/upstream-status**", (route) =>
    route.fulfill({ json: { degraded: false, paused: false } }),
  );
  await page.route("**/api/coaching/availability**", (route) =>
    route.fulfill({ json: { available: false } }),
  );
}

async function openGrid(page: Page) {
  // Suppress the first-visit dialogs -- their overlay intercepts pointer
  // events and this suite is about the grid, not the release notes.
  await page.addInitScript((releaseId) => {
    localStorage.setItem("ssi-cell-help-seen", "1");
    localStorage.setItem("whats-new-seen-id", releaseId);
  }, LATEST_RELEASE_ID);
  await mockApis(page);
  await page.goto("/match/22/88888888?competitors=100,101,102");
  // exact: true -- "S1" would otherwise also match S10, S11 and S12.
  await expect(
    page.getByRole("columnheader", { name: "S1", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("live grid", () => {
  test("does not overflow the page horizontally", async ({ page }) => {
    await openGrid(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("every cell button meets the 44px touch floor", async ({ page }) => {
    await openGrid(page);
    const heights = await page
      .locator("[data-live-grid-scroller] tbody button")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });

  test("opens the detail sheet on cell tap and closes it", async ({ page }) => {
    await openGrid(page);
    // The grid opens scrolled to the live edge, so the earliest cells sit
    // under the sticky shooter column. Click one that is actually in view.
    await page
      .locator('[data-live-grid-scroller] tbody button')
      .filter({ hasText: /\d/ })
      .last()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /close detail/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("rail jump scrolls the grid", async ({ page }) => {
    await openGrid(page);
    const scroller = page.locator("[data-live-grid-scroller]");
    const before = await scroller.evaluate((e) => e.scrollLeft);
    await page.getByRole("button", { name: "Jump to stage 12" }).click();
    await expect
      .poll(() => scroller.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(before);
  });

  test("never calls /api/compare while the grid is showing", async ({
    page,
  }) => {
    // The whole point of the grid is that it does not pull the whole-field
    // snapshot. If compare fires alongside it, the upstream saving is gone.
    const compareCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/compare")) compareCalls.push(req.url());
    });
    await openGrid(page);
    await page.waitForTimeout(1500);
    expect(compareCalls).toEqual([]);
  });

  test("switching to full analysis leaves the grid", async ({ page }) => {
    await openGrid(page);
    await page.getByRole("button", { name: /full analysis/i }).click();
    await expect(
      page.getByRole("columnheader", { name: "S1", exact: true }),
    ).toBeHidden();
  });
});
