import { test, expect, type Page } from "@playwright/test";
import type { MatchResponse } from "@/lib/types";
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

async function mockApis(page: Page) {
  await page.route("**/api/match/**", (route) =>
    route.fulfill({ json: MOCK_MATCH }),
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

test.describe("match tabs", () => {
  test("info tab shows the match header and squad rotation", async ({ page }) => {
    await suppressDialogs(page);
    await mockApis(page);
    await page.goto("/match/22/88888888/info");
    await expect(page.getByRole("heading", { name: "Live Grid Test Match" })).toBeVisible();
    await expect(page.getByText(/results are not yet officially published/i)).toBeVisible();
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

test("pre-match grid never fetches live-grid until the user opts in", async ({ page }) => {
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
  let gridCalls = 0;
  await page.route("**/api/live-grid**", (r) => {
    gridCalls++;
    return r.fulfill({ json: { stages: [], shooters: [], cells: {} } });
  });
  await page.goto("/match/22/88888888");
  await expect(page.getByText("Scoring has not really started")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(gridCalls).toBe(0);
  await page.getByRole("button", { name: "Show live scores" }).click();
  await expect.poll(() => gridCalls).toBeGreaterThan(0);
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
  const heights = await page
    .getByRole("navigation", { name: "Match sections" })
    .getByRole("link")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
