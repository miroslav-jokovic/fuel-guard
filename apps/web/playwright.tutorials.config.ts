import path from "node:path";
import { defineConfig } from "@playwright/test";
import { TIMEZONE } from "./tutorials/fixtures/world";

/**
 * Tutorial recordings (`tutorials/README.md`) — the THIRD Playwright config, and why it is not one of
 * the other two: `playwright.config.ts` drives a deployed app (production smoke) and
 * `playwright.apply.config.ts` is CI's applicant suite on a phone. These film the office app at
 * 1920×1080 against a stubbed backend, one at a time, at speaking pace.
 *
 * The page is the production bundle served by the API's own `createApp` with production's CSP
 * (`serveWebDist.ts`, the applicant specs' server), but from its OWN build in `tutorials/build`: that
 * build is made with every `VITE_*` value pinned (`tutorials/make.ts`), so a developer's `.env` — an
 * API origin the CSP refuses, a dev bypass, a "UAT" banner — can never end up on camera.
 */
export const TUTORIAL_PORT = 4195;
const ORIGIN = `http://127.0.0.1:${TUTORIAL_PORT}`;
export const TUTORIAL_DIST = path.resolve(import.meta.dirname, "tutorials/build");

export default defineConfig({
  testDir: "./tutorials",
  testMatch: /\.spec\.ts$/,
  // One at a time: two recordings sharing the CPU drop frames from both.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: ORIGIN,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: TIMEZONE,
    colorScheme: "light",
    serviceWorkers: "block",
    // ⚠ OFF while filming. A trace runs its own screencast, and a screencast already running wins
    // (`screencast.start`'s `size` is then ignored): the first recording came out as an 800×450 page in
    // the corner of a 1920×1080 frame. `check` runs keep the trace, where a failure needs it.
    trace: process.env.TUTORIAL_MODE === "record" ? "off" : "retain-on-failure",
    // A locator that matches nothing fails in seconds, not at the 15-minute recording timeout.
    actionTimeout: 15_000,
  },
  webServer: {
    command: "pnpm --filter @silvicom/api serve:web-dist",
    url: `${ORIGIN}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(TUTORIAL_PORT), WEB_DIST: TUTORIAL_DIST },
  },
});
