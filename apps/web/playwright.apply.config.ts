import { defineConfig } from "@playwright/test";
import { APPLY_E2E_PORT, ORIGIN } from "./e2e-apply/stubApi";

/**
 * The applicant's page in a real browser, against the BUILT app and a stubbed API (C3d3b1,
 * APPLICATION-FLOW-V2-PLAN.md §6.8) — the first browser tests CI runs.
 *
 * ── WHY A SECOND CONFIG, AND A SECOND FOLDER ───────────────────────────────────────────────────
 * `playwright.config.ts` runs `e2e/` against a DEPLOYED app: `smoke.yml` points it at production after
 * every deploy. These specs stub the API instead, so they need no database, no login and no network,
 * and can run on every pull request. A spec in `e2e/` would also run against production on the next
 * smoke run, which is not what it was written for — so they live in `e2e-apply/`, and this config is
 * the only one that reads that folder.
 *
 * ── WHAT IS REAL AND WHAT IS NOT ────────────────────────────────────────────────────────────────
 * Real: the production bundle (`vite build`, served by `vite preview` exactly as built), Chromium,
 * IndexedDB, the image encoder, reloads, going offline. Stubbed: every `/api/public/application/**`
 * request and the storage upload, answered with the API's RAW JSON (the public surface has no
 * `{ ok, data }` envelope — `e2e-apply/stubApi.ts`), and every other request is refused, so a spec
 * can never reach a real service by accident.
 *
 * ⚠ `dist` must exist: CI builds it in `typecheck-build` before this runs; locally,
 * `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key pnpm --filter
 * @silvicom/web build` first. The two values are CI's placeholders — the page never calls Supabase.
 */
export default defineConfig({
  testDir: "./e2e-apply",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: ORIGIN,
    // A phone: the size §6.8 measures at, touch, and a coarse pointer — which is what makes the page
    // treat it as a phone rather than offering the desktop hand-off (`useIsDesktop`).
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `pnpm exec vite preview --port ${APPLY_E2E_PORT} --strictPort --host 127.0.0.1`,
    url: `${ORIGIN}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // ⚠ `vite.config.ts` refuses to start a PRODUCTION config without these, preview included. Preview
    // only serves `dist`, which is already built, so CI's placeholders are all it needs here.
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "ci-test-anon-key",
    },
  },
});
