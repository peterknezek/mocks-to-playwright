import { defineConfig, devices } from "@playwright/test";

// Integration tests with a real browser; the unit tests run with `bun test`
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
