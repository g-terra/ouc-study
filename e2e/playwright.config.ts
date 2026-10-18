// Smoke tests: the app starts on the demo semester and every page renders without errors (npm run e2e at the root).
// CI runs them on every PR and before release-please publishes a release.
import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "5180";
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",                       // where CI picks up the traces
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    // a Chromium that is already installed (e.g. PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome)
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "node --import tsx serve.ts", url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
