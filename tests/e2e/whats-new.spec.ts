import { test, expect, type Page } from "@playwright/test";

// 390px -- iPhone 14. Deliberately NO `whats-new-seen-id` suppression here:
// this suite is about the unseen-release dot.
test.use({ viewport: { width: 390, height: 844 } });

// Quiet every API call so the pages render without touching a real upstream.
async function mockApis(page: Page) {
  await page.route("**/api/upstream-status**", (route) =>
    route.fulfill({ json: { degraded: false, paused: false } }),
  );
  await page.route("**/api/events**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/match/**", (route) =>
    route.fulfill({ status: 404, json: { error: "not found" } }),
  );
  await page.route("**/api/live-grid**", (route) =>
    route.fulfill({ status: 404, json: { error: "not found" } }),
  );
}

test.describe("what's new dot", () => {
  test("never auto-opens the dialog on the home page", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("never auto-opens the dialog inside a match", async ({ page }) => {
    await mockApis(page);
    await page.goto("/match/22/88888888");
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dot shows on More, opens release notes on demand and clears for good", async ({
    page,
  }) => {
    await mockApis(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("button", { name: /new release notes/ })).toBeVisible();

    await nav.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /What's new/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(nav.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /new release notes/ })).toHaveCount(0);

    await page.reload();
    await expect(nav.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /new release notes/ })).toHaveCount(0);
  });
});
