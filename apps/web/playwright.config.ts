import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests. Run against a deployed/served app:
//   BASE_URL=http://localhost:5173 pnpm --filter @fleetguard/web e2e
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
