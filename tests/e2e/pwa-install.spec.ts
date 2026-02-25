import { test, expect } from "@playwright/test";

// Simulate iPhone Safari user agent for iOS-branch tests
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test.describe("PWA install — About page", () => {
  test("about page has an install section", async ({ page }) => {
    await page.goto("/about");
    await expect(
      page.getByRole("heading", { name: /install as an app/i })
    ).toBeVisible();
  });

  test("about page install section renders instructions", async ({ page }) => {
    await page.goto("/about");
    // The fallback (generic instructions) is shown on desktop Chromium
    // — verify the section has actionable content
    const section = page.locator("#install");
    await expect(section).toBeVisible();
    await expect(section.getByText(/progressive web app/i)).toBeVisible();
  });

  test("about page shows 'already installed' when in standalone mode", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // matches is a read-only getter — return a full mock object for standalone
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string): MediaQueryList => {
        if (query === "(display-mode: standalone)") {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return original(query);
      };
    });
    await page.goto("/about");
    await expect(page.getByText(/already installed/i)).toBeVisible();
  });

  test("about page shows iOS instructions when on iOS", async ({ page }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
    }, IOS_UA);
    await page.goto("/about");
    // iOS flow shows the numbered list with "Add to Home Screen"
    await expect(
      page.locator("#install").getByText(/add to home screen/i).first()
    ).toBeVisible();
  });
});

test.describe("PWA install — footer link", () => {
  test("footer contains Install app link pointing to /about#install", async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /install app/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/about#install");
  });
});

test.describe("PWA install — banner", () => {
  test("iOS banner is visible on first visit (iOS UA, not standalone)", async ({
    page,
  }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
      // Ensure not standalone
      Object.defineProperty(navigator, "standalone", {
        value: false,
        configurable: true,
      });
    }, IOS_UA);

    await page.goto("/");
    await expect(page.getByText(/add to home screen/i)).toBeVisible();
  });

  test("iOS banner is hidden when already dismissed", async ({ page }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
      localStorage.setItem("pwa-install-dismissed", "1");
    }, IOS_UA);

    await page.goto("/");
    await expect(page.getByText(/add to home screen/i)).not.toBeVisible();
  });

  test("iOS banner is hidden when running in standalone mode", async ({
    page,
  }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
      // Simulate standalone (navigator.standalone = true is the iOS signal)
      Object.defineProperty(navigator, "standalone", {
        value: true,
        configurable: true,
      });
    }, IOS_UA);

    await page.goto("/");
    await expect(page.getByText(/add to home screen/i)).not.toBeVisible();
  });

  test("dismissing iOS banner hides it immediately", async ({ page }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
    }, IOS_UA);

    await page.goto("/");
    await expect(page.getByText(/add to home screen/i)).toBeVisible();

    await page
      .getByRole("button", { name: /dismiss install instructions/i })
      .click();
    await expect(page.getByText(/add to home screen/i)).not.toBeVisible();
  });

  test("dismissed state persists across navigation", async ({ page }) => {
    await page.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", {
        value: ua,
        configurable: true,
      });
    }, IOS_UA);

    await page.goto("/");
    await page
      .getByRole("button", { name: /dismiss install instructions/i })
      .click();

    // Navigate away and back — banner must stay hidden
    await page.goto("/about");
    await page.goto("/");
    await expect(page.getByText(/add to home screen/i)).not.toBeVisible();
  });
});
