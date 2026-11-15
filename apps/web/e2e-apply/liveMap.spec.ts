import { expect, test } from "@playwright/test";
import { ORIGIN } from "./stubApi";

/**
 * The live map, built, in Chromium, from the server that sends production's headers (INSTALLED-APP-PLAN IA12).
 *
 * ── WHY A BROWSER, AND WHY HERE ────────────────────────────────────────────────────────────────
 * maplibre needs WebGL and a worker, so every unit test of the map stands a fake in for it
 * (`useMapLibre.test.ts`, `LiveMapWorkspace.test.ts`). That left the one question the upgrade to maplibre 6
 * turned on with nothing asking it: does the BUILT app find its worker? maplibre 6 stopped inlining the worker
 * and loads `maplibre-gl-worker.mjs` by address; the first build of the upgrade (2026-11-15) shipped no such
 * file, every unit test passed, and the map would have drawn nothing — in production only. This is the test
 * that fails for that build: no worker, no tile is ever requested.
 *
 * It also runs under `securityMiddleware`'s real Content-Security-Policy (`serve:web-dist` mounts
 * `createApp`), which vite and `preview:local` do not send — so a worker or tile the policy refuses fails here.
 *
 * ── WHAT IT DOES NOT SEE ───────────────────────────────────────────────────────────────────────
 * Tiles are a stub: one transparent pixel for a raster tile, nothing for a vector one. So this proves the map
 * starts and asks; it says nothing about how HERE's tiles, the place icons or the truck markers LOOK. That
 * is a person's check on staging.
 *
 * The signed-in session is `assistantDock.spec.ts`'s: the app only decodes its token, the API verifies it.
 */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
const ACCESS = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-admin", email: "admin@e2e.test", org_id: "org-e2e", user_role: "admin", exp })}.e2e`;
const SESSION = {
  access_token: ACCESS, refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 365 * 86400, expires_at: exp,
  user: { id: "u-admin", email: "admin@e2e.test", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
/** One transparent pixel. */
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** An empty fleet, as the API answers it (`LiveMapBoard`): the map mounts with no truck on it. */
const BOARD = {
  ok: true,
  data: {
    generatedAt: new Date().toISOString(), scope: "all", scopeReason: "Every truck in the fleet.",
    bounds: { stoppedSpeedMph: 2, engineOnBoundSeconds: 900, offlineBoundSeconds: 900, fuelStaleSeconds: 3600 },
    vehicles: [], untracked: [], truncated: false,
  },
};

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("the built live map starts its worker from this server and asks for tiles", async ({ page }) => {
  const refused: string[] = [];
  const workerAnswers: Array<{ status: number; type: string }> = [];
  const tiles: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to|worker/i.test(m.text())) refused.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => refused.push(e.message.slice(0, 200)));
  page.on("response", (r) => {
    if (/\/assets\/maplibre-gl-worker/.test(r.url())) workerAnswers.push({ status: r.status(), type: r.headers()["content-type"] ?? "" });
  });

  await page.addInitScript((s) => localStorage.setItem("sb-example-auth-token", s), JSON.stringify(SESSION));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/fueling/map-tiles/")) {
      tiles.push(url.pathname);
      return /\/(vector|truck-places)\//.test(url.pathname) ? route.fulfill({ status: 204, body: "" }) : route.fulfill({ status: 200, contentType: "image/png", body: TILE });
    }
    if (url.origin === ORIGIN && !url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/livemap/positions") return route.fulfill({ json: BOARD });
    if (url.pathname === "/api/me") return route.fulfill({ json: { fullName: "E2E Admin", surfaces: {}, permissions: null } });
    if (url.pathname === "/rest/v1/org_modules") {
      return route.fulfill({ json: ["dispatch", "navigation"].map((module_key) => ({ module_key, enabled: true, config: {} })) });
    }
    if (url.origin === ORIGIN || url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });

  await page.goto("/?tab=dispatch");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  // The worker is this server's own file, served as a script — not the SPA's index.html answering for a
  // path that does not exist, which is what a missing worker file looks like from outside (a 200, as HTML).
  await expect.poll(() => workerAnswers.length).toBeGreaterThan(0);
  expect(workerAnswers[0]!.status).toBe(200);
  expect(workerAnswers[0]!.type).toMatch(/javascript/);
  // A map with no working worker never gets as far as asking for a tile.
  await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(refused).toEqual([]);
});
