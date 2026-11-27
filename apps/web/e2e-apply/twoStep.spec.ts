import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./stubApi";

/**
 * Two-step sign-in by an emailed code, built, in Chromium (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20).
 *
 * ── WHY A BROWSER ─────────────────────────────────────────────────────────────────────────────────
 * The unit tests hold each piece to its rule with the others faked: the guard with a fake store, the page with a
 * fake API, the store with a fake API. What none of them can say is whether the pieces MEET — whether a real sign-in
 * on a browser that owes its code lands on the code page, in the layout that does not call the API it would be
 * refused by, whether opening it sends exactly one code, and whether the right code lets it into the app. This runs
 * the built app against the API as raw JSON, the way `liveMap.spec.ts` does.
 *
 * ── WHAT IT DOES NOT SEE ──────────────────────────────────────────────────────────────────────────
 * The email itself, and the database's week: those are `secondFactor.test.ts` (API) and
 * `two-step-email-codes.test.mjs` (0662). The stub keys the week to the browser's device header, as 0662 does.
 */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-disp", email: "dispatch@e2e.test", org_id: "org-e2e", user_role: "dispatcher", aud: "authenticated", exp, session_id: "5e551011-0000-4000-8000-000000000001" })}.sig`;
const USER = { id: "u-disp", email: "dispatch@e2e.test", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: token, refresh_token: "e2e-refresh", expires_in: 365 * 86400, expires_at: exp, token_type: "bearer", user: USER };

/** `trusted`: the device keys that gave their code this week — the stub's two_step_devices. */
interface World { trusted: Set<string>; sent: number; entered: string[]; refusedCalls: string[] }

async function serve(page: Page, world: World) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && !url.pathname.startsWith("/api/")) return route.continue();
    const device = req.headers()["x-silvicom-device"] ?? "";
    const ok = world.trusted.has(device);
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: USER });
    // ── the API ──
    if (url.pathname === "/api/me/second-factor") {
      return route.fulfill({ json: { required: true, satisfied: ok, email_hint: "d•••@e2e.test", trusted_until: ok ? "2026-12-08T12:00:00.000Z" : null } });
    }
    if (url.pathname === "/api/me/second-factor/code") {
      world.sent += 1;
      return route.fulfill({ json: { outcome: "sent", expires_at: new Date(Date.now() + 600_000).toISOString() } });
    }
    if (url.pathname === "/api/me/second-factor/verify") {
      const code = (req.postDataJSON() as { code?: string }).code ?? "";
      world.entered.push(code);
      if (code !== "042917") return route.fulfill({ status: 422, json: { error: { code: "wrong_code", message: "That code is not right. Check the latest email and try again." } } });
      world.trusted.add(device);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/api/version") return route.fulfill({ json: { commit: "e2e", schema: { state: "current" } } });
    if (url.pathname.startsWith("/api/") && !ok) {
      world.refusedCalls.push(url.pathname);
      return route.fulfill({ status: 403, json: { error: { code: "second_factor_required", message: "Enter the sign-in code we emailed you to continue." } } });
    }
    if (url.pathname === "/api/me") return route.fulfill({ json: { fullName: "E2E Dispatcher", surfaces: {}, permissions: null } });
    if (url.pathname === "/rest/v1/org_modules") return route.fulfill({ json: [{ module_key: "dispatch", enabled: true, config: {} }] });
    if (url.origin === ORIGIN || url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });
  await page.addInitScript((s) => { if (!localStorage.getItem("sb-example-auth-token")) localStorage.setItem("sb-example-auth-token", s); }, JSON.stringify(SESSION));
}
const world = (): World => ({ trusted: new Set(), sent: 0, entered: [], refusedCalls: [] });

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("a browser that owes its code is held on the code page, one code is sent, and the right code lets it in", async ({ page }) => {
  const w = world();
  await serve(page, w);
  await page.goto("/drivers");
  await expect(page).toHaveURL(/\/two-step$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByTestId("two-step-lead")).toContainText("d•••@e2e.test");
  // Not inside the app's shell, no way around it, and nothing asked the API for what it would have been refused.
  await expect(page.getByRole("button", { name: /Account menu/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(w.refusedCalls).toEqual([]);
  expect(w.sent).toBe(1);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code is not right.");
  await expect(page).toHaveURL(/\/two-step$/);

  await page.getByLabel("6-digit code").fill("042917");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: /Account menu/ }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/two-step/);
  expect(w.entered).toEqual(["000000", "042917"]);
  expect(w.refusedCalls).toEqual([]);
  expect(w.sent).toBe(1);
});

test("a browser that gave its code this week goes straight in, and no email is sent", async ({ page }) => {
  const w = world();
  await serve(page, w);
  // The app makes its device key on first load; trust whichever key it sends.
  await page.goto("/drivers");
  // That first visit owes the code and sends one; wait for it so it is not counted against the second.
  await expect.poll(() => w.sent).toBe(1);
  const key = await page.evaluate(() => localStorage.getItem("silvicom.device-key"));
  w.trusted.add(key ?? "");
  w.sent = 0;
  await page.goto("/drivers");
  await expect(page).toHaveURL(/\/drivers$/);
  await expect(page.getByRole("button", { name: /Account menu/ }).first()).toBeVisible();
  expect(w.sent).toBe(0);
});
