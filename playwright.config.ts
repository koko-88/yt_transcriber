// Playwright configuration for the extension smoke test.
// The test loads the production Chromium build from .output/chrome-mv3, so
// `npm run build` must run first (CI does this).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
  },
});
