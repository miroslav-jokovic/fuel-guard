import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./stubApi";

/**
 * Two-step sign-in, built, in Chromium (INSTALLED-APP-PLAN IA-S1).
 *
 * ── WHY A BROWSER ─────────────────────────────────────────────────────────────────────────────────
 * The unit tests hold each piece to its rule with the others faked: the guard with a fake store, the page with
 * a fake Supabase, the store with a fake API. What none of them can say is whether the pieces MEET — whether a
 * real sign-in that owes its code actually lands on the code page, in the layout that does not call the API it
 * would be refused by, and whether the right code actually lets it into the app. This runs the built app
 * against the API and the auth server as raw JSON, the way `liveMap.spec.ts` does.
 *
 * ── WHAT IT DOES NOT SEE ──────────────────────────────────────────────────────────────────────────
 * The auth server is a stub: that a real authenticator app's code is accepted is Supabase's, and was checked
 * by hand against staging (a factor enrolled and removed for the test login, 2026-11-15).
 */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
const token = (aal: "aal1" | "aal2") =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-admin", email: "admin@e2e.test", org_id: "org-e2e", user_role: "admin", aud: "authenticated", exp, aal, session_id: "5e551011-0000-4000-8000-000000000001" })}.sig`;
const USER = { id: "u-admin", email: "admin@e2e.test", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const session = (aal: "aal1" | "aal2") => ({ access_token: token(aal), refresh_token: "e2e-refresh", expires_in: 365 * 86400, expires_at: exp, token_type: "bearer", user: USER });
const FACTOR = { id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", friendly_name: "Authenticator app", factor_type: "totp", status: "verified", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };

interface World { hasFactor: boolean; dueFrom: string | null; pastDate: boolean; refusedCalls: string[]; verified: string[] }

/** The API and the auth server, as they answer. `aalOf` reads the level off the request's own bearer token. */
async function serve(page: Page, world: World) {
  const aalOf = (auth: string | undefined) => { try { return JSON.parse(Buffer.from((auth ?? "").split(".")[1] ?? "", "base64url").toString()).aal as string; } catch { return null; } };
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && !url.pathname.startsWith("/api/")) return route.continue();
    const aal = aalOf(req.headers()["authorization"]);
    const required = world.hasFactor || world.pastDate;
    // ── the auth server ──
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: { ...USER, factors: world.hasFactor ? [FACTOR] : [] } });
    if (url.pathname === "/auth/v1/factors" && req.method() === "POST") {
      return route.fulfill({ json: { id: FACTOR.id, type: "totp", friendly_name: "Authenticator app", totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10'/></svg>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" } } });
    }
    if (/^\/auth\/v1\/factors\/[^/]+\/challenge$/.test(url.pathname)) return route.fulfill({ json: { id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", type: "totp", expires_at: exp } });
    if (/^\/auth\/v1\/factors\/[^/]+\/verify$/.test(url.pathname)) {
      const code = (req.postDataJSON() as { code?: string }).code ?? "";
      world.verified.push(code);
      if (code !== "123456") return route.fulfill({ status: 422, json: { code: 422, error_code: "mfa_verification_failed", msg: "Invalid TOTP code entered" } });
      world.hasFactor = true;
      return route.fulfill({ json: session("aal2") });
    }
    // ── the API ──
    if (url.pathname === "/api/me/second-factor") {
      return route.fulfill({ json: { required, satisfied: aal === "aal2", has_factor: world.hasFactor, due_from: !required ? world.dueFrom : null, must_keep: world.pastDate } });
    }
    // Public, as on the real API: the shell's version read is not behind a sign-in at all.
    if (url.pathname === "/api/version") return route.fulfill({ json: { commit: "e2e", schema: { state: "current" } } });
    if (url.pathname.startsWith("/api/") && required && aal !== "aal2") {
      world.refusedCalls.push(url.pathname);
      return route.fulfill({ status: 403, json: { error: { code: "second_factor_required", message: "Enter the code from your authenticator app to continue." } } });
    }
    if (url.pathname === "/api/me") return route.fulfill({ json: { fullName: "E2E Admin", surfaces: {}, permissions: null } });
    if (url.pathname === "/rest/v1/org_modules") return route.fulfill({ json: [{ module_key: "dispatch", enabled: true, config: {} }] });
    if (url.origin === ORIGIN || url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });
  await page.addInitScript((s) => { if (!localStorage.getItem("sb-example-auth-token")) localStorage.setItem("sb-example-auth-token", s); }, JSON.stringify(session("aal1")));
}
const world = (over: Partial<World> = {}): World => ({ hasFactor: false, dueFrom: null, pastDate: false, refusedCalls: [], verified: [], ...over });

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("a sign-in that owes its code is held on the code page, and the right code lets it in", async ({ page }) => {
  const w = world({ hasFactor: true });
  await serve(page, w);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/two-step$/);
  await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
  await expect(page.getByText("Enter the 6-digit code from your authenticator app.")).toBeVisible();
  // The page is NOT inside the app's shell, and nothing asked the API for what it would have been refused.
  await expect(page.getByRole("button", { name: /Account menu/ })).toHaveCount(0);
  expect(w.refusedCalls).toEqual([]);
  await expect(page.getByRole("button", { name: "Not now" })).toHaveCount(0);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code was not accepted.");
  await expect(page).toHaveURL(/\/two-step$/);

  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: /Account menu/ }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/two-step/);
  expect(w.verified).toEqual(["000000", "123456"]);
  expect(w.refusedCalls).toEqual([]);
});

test("an admin in their notice period uses the app, is told the date, and can set it up from the notice", async ({ page }) => {
  const w = world({ dueFrom: "2026-12-01T15:00:00Z" });
  await serve(page, w);
  await page.goto("/drivers");
  await expect(page).toHaveURL(/\/drivers$/);
  const notice = page.getByTestId("second-factor-notice");
  await expect(notice).toContainText("From 12/01/2026, admins sign in with a code from an authenticator app");
  await notice.getByRole("link", { name: "Set it up now" }).click();
  await expect(page).toHaveURL(/\/two-step$/);
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await expect(page.getByTestId("two-step-secret")).toHaveText("JBSWY3DPEHPK3PXP");
  // Nothing requires it yet, so there is a way back.
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByRole("button", { name: /Account menu/ }).first()).toBeVisible();
  await expect(page.getByTestId("second-factor-notice")).toHaveCount(0);
});

test("an admin past their date is walked through setting it up before the app opens", async ({ page }) => {
  const w = world({ pastDate: true });
  await serve(page, w);
  await page.goto("/");
  await expect(page).toHaveURL(/\/two-step$/);
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Not now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(w.refusedCalls).toEqual([]);
});
