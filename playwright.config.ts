import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // In CI the production build is already done — serve the standalone output directly
    // (next start is incompatible with output: "standalone"). Locally use next dev.
    // HOSTNAME is pinned to 0.0.0.0: Next's standalone server.js binds to
    // process.env.HOSTNAME, and inside a container (the CI job runs in the
    // Playwright image) Docker sets HOSTNAME to the container ID, so the server
    // would bind to the container's internal IP and the localhost:3000
    // healthcheck would never connect. 0.0.0.0 binds all interfaces incl. loopback.
    command: process.env.CI
      ? "HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js"
      : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
