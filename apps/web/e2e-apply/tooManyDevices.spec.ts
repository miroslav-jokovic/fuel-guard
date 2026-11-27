import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./stubApi";

/**
 * Three devices at most, built, in Chromium (INSTALLED-APP-PLAN IA-S6; the owner's ruling Q-IA14 (b)).
 *
 * The unit tests hold each piece to its rule with the others faked — the API's refusal, `lib/api.ts`'s redirect,
 * the page. What none of them can say is whether they MEET: whether a fourth device opening any page of the app
 * really lands on the devices page, in the layout that does not call what it would be refused, whether every
 * request it makes carries the device key, and whether signing one device out really lets it in. This runs the
 * built app against the API as raw JSON, the way `twoStep.spec.ts` does.
 *
 * What it does not see: the database's admission rule, which `supabase/tests/member-devices.test.mjs` executes.
 */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
const THIS = "5e551011-0000-4000-8000-000000000001";
const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-disp", email: "disp@e2e.test", org_id: "org-e2e", user_role: "dispatcher", aud: "authenticated", exp, aal: "aal1", session_id: THIS })}.sig`;
const USER = { id: "u-disp", email: "disp@e2e.test", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: token, refresh_token: "e2e-refresh", expires_in: 365 * 86400, expires_at: exp, token_type: "bearer", user: USER };

const device = (n: number, name: string, ip: string) => ({
  id: `d0d0d0d0-0000-4000-8000-00000000000${n}`, device: name, current: false, signed_in: true,
  session_id: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`, first_seen_at: "2026-11-10T09:00:00Z", last_seen_at: "2026-11-16T12:00:00Z",
  addresses: [{ ip, first_seen_at: "2026-11-10T09:00:00Z", last_seen_at: "2026-11-16T12:00:00Z" }],
});

interface World { places: ReturnType<typeof device>[]; refused: string[]; ended: string[]; keys: Set<string>; keyless: string[] }

async function serve(page: Page, world: World) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN && !url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: { ...USER, factors: [] } });
    if (url.pathname === "/api/version") return route.fulfill({ json: { commit: "e2e", schema: { state: "current" } } });
    if (url.pathname.startsWith("/api/")) {
      const key = req.headers()["x-silvicom-device"];
      if (key) world.keys.add(key);
      else world.keyless.push(url.pathname);
    }
    const full = world.places.length >= 3;
    // The two routes a fourth device may call, as `requireAuthOverLimit` lets them through.
    if (url.pathname === "/api/me/devices") return route.fulfill({ json: { devices: world.places, limit: 3, history_days: 365 } });
    const end = /^\/api\/me\/sessions\/([^/]+)$/.exec(url.pathname);
    if (end && req.method() === "DELETE") {
      world.ended.push(end[1]!);
      world.places = world.places.filter((d) => d.session_id !== end[1]);
      return route.fulfill({ json: { ended: true } });
    }
    if (url.pathname.startsWith("/api/") && full) {
      world.refused.push(url.pathname);
      return route.fulfill({ status: 403, json: { error: { code: "device_limit", message: "You are signed in on 3 devices. Sign one out to use this one." } } });
    }
    if (url.pathname === "/api/me/second-factor") return route.fulfill({ json: { required: true, satisfied: true, email_hint: "d•••@e2e.test", trusted_until: null } });
    if (url.pathname === "/api/me") return route.fulfill({ json: { fullName: "E2E Dispatcher", surfaces: {}, permissions: null } });
    if (url.pathname === "/rest/v1/org_modules") return route.fulfill({ json: [{ module_key: "dispatch", enabled: true, config: {} }] });
    if (url.origin === ORIGIN || url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });
  await page.addInitScript((s) => { if (!localStorage.getItem("sb-example-auth-token")) localStorage.setItem("sb-example-auth-token", s); }, JSON.stringify(SESSION));
}
const world = (): World => ({
  places: [device(1, "Chrome on Windows", "203.0.113.7"), device(2, "Safari on iPhone", "198.51.100.24"), device(3, "Edge on Windows", "192.0.2.10")],
  refused: [], ended: [], keys: new Set(), keyless: [],
});

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("a fourth device lands on its devices page, signs one out, and is let in", async ({ page }) => {
  const w = world();
  await serve(page, w);
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/too-many-devices$/);
  await expect(page.getByRole("heading", { name: "You are signed in on 3 devices" })).toBeVisible();
  // The three holding the places, each with where it was last used — and the page is outside the shell.
  for (const name of ["Chrome on Windows", "Safari on iPhone", "Edge on Windows"]) await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText("198.51.100.24")).toBeVisible();
  await expect(page.getByRole("button", { name: /Account menu/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Sign out Safari on iPhone/ }).click();
  await expect(page.getByRole("status")).toContainText("Safari on iPhone is signed out");
  expect(w.ended).toEqual(["bbbbbbbb-bbbb-4bbb-8bbb-000000000002"]);

  const refusedBefore = w.refused.length;
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/too-many-devices/);
  await expect(page.getByRole("button", { name: /Account menu/ })).toBeVisible();
  expect(w.refused.length).toBe(refusedBefore);
});

test("every request the app made carried one and the same device key", async ({ page }) => {
  const w = world();
  w.places = w.places.slice(0, 2);
  await serve(page, w);
  await page.goto("/assignments");
  await expect(page.getByRole("button", { name: /Account menu/ })).toBeVisible();
  expect(w.keyless).toEqual([]);
  expect(w.keys.size).toBe(1);
  expect([...w.keys][0]).toMatch(/^[a-f0-9]{32}$/);
});

test("signing this device out instead goes to the sign-in page", async ({ page }) => {
  const w = world();
  await serve(page, w);
  await page.goto("/too-many-devices");
  await page.getByRole("button", { name: "Sign out of this device instead" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(w.ended).toEqual([]);
});
