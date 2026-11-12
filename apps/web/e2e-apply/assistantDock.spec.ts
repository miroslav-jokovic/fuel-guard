import { expect, test, type Page, type Route } from "@playwright/test";
import { encodeAssistantEvent, type AssistantStreamEvent } from "@silvicom/shared";
import { ORIGIN } from "./stubApi";

/**
 * Ask AI's dock in a real browser (F21 Step 3a's acceptance, PLAN §4): keyboard only, a 390 px phone,
 * reduced motion, and the states a reader can meet — the streamed answer, a spent budget.
 *
 * ── SIGNED IN, WITHOUT A SIGN-IN ────────────────────────────────────────────────────────────────
 * The app only DECODES its access token (`lib/jwt.ts`), never verifies it — the API does. So a session
 * written where supabase-js keeps it (`sb-<project ref>-auth-token`, the ref being the first label of
 * CI's placeholder `VITE_SUPABASE_URL`, `example`) signs the built app in as an admin, with an expiry a
 * year out so supabase-js never tries to refresh it. Nothing here needs a build flag: this is the
 * production bundle `e2e-apply` already tests.
 *
 * ── THE STUB ────────────────────────────────────────────────────────────────────────────────────
 * Raw JSON, as the API answers. `/api/me` names the caller; `/api/ai/ask` answers as the test says;
 * every other `/api/**` and Supabase REST read is an empty list, which is what an empty carrier
 * returns, and the shell around the dock draws its quiet state. Anything else is refused.
 */

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
const ACCESS = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-admin", email: "admin@e2e.test", org_id: "org-e2e", user_role: "admin", exp })}.e2e`;
const SESSION = {
  access_token: ACCESS,
  refresh_token: "e2e-refresh",
  token_type: "bearer",
  expires_in: 365 * 86400,
  expires_at: exp,
  user: { id: "u-admin", email: "admin@e2e.test", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

const sse = (events: AssistantStreamEvent[]) => ({ status: 200, contentType: "text/event-stream", body: events.map(encodeAssistantEvent).join("") });

async function signedIn(page: Page, ask: (route: Route) => Promise<void>) {
  await page.addInitScript((s) => localStorage.setItem("sb-example-auth-token", s), JSON.stringify(SESSION));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && !url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/ai/ask") return ask(route);
    if (url.pathname === "/api/me") return route.fulfill({ json: { fullName: "E2E Admin", surfaces: {}, permissions: null } });
    if (url.origin === ORIGIN || url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });
}

const ANSWER: AssistantStreamEvent[] = [
  { type: "step", label: "Reading the fuel report" },
  { type: "text", delta: "Fuel spend last month was " },
  { type: "text", delta: "$41,200." },
  { type: "done", answer: "Fuel spend last month was $41,200.", pages: ["fuel.spend"], links: [] },
];

test.describe("desktop, keyboard only", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("opens on the shortcut with focus in the question, answers, and closes on Escape back to the launcher", async ({ page }) => {
    let asked: unknown = null;
    await signedIn(page, async (route) => {
      asked = route.request().postDataJSON();
      expect(route.request().headers().accept).toContain("text/event-stream");
      await route.fulfill(sse(ANSWER));
    });
    await page.goto("/settings");
    const launcher = page.getByRole("button", { name: /^Ask AI/ });
    await expect(launcher).toBeVisible();

    await page.keyboard.press("Control+j");
    const dock = page.getByRole("dialog", { name: "Ask AI" });
    await expect(dock).toBeVisible();
    // Non-modal: the page behind stays in the accessibility tree and nothing traps it.
    await expect(dock).toHaveAttribute("aria-modal", "false");
    const question = dock.getByRole("textbox");
    await expect(question).toBeFocused();

    await page.keyboard.type("What was fuel spend last month?");
    await page.keyboard.press("Enter");
    await expect(dock.getByText("Fuel spend last month was $41,200.")).toBeVisible();
    expect(asked).toMatchObject({ question: "What was fuel spend last month?", history: [] });
    await expect(dock.getByRole("link", { name: /Open in/ })).toBeVisible();

    await question.focus();
    await page.keyboard.press("Escape");
    await expect(dock).toBeHidden();
    await expect(launcher).toBeFocused();
  });

  test("a spent budget says so and when it resets, with no Try again to be refused the same way", async ({ page }) => {
    await signedIn(page, (route) =>
      route.fulfill({ status: 429, json: { error: { code: "ai_budget_exhausted", message: "Ask AI has reached this month's spending cap. It resets on the 1st." } } }),
    );
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /^Ask AI/ })).toBeVisible();
    await page.keyboard.press("Control+j");
    const dock = page.getByRole("dialog", { name: "Ask AI" });
    await dock.getByRole("textbox").fill("fuel spend");
    await page.keyboard.press("Enter");
    await expect(dock.getByText("It resets on the 1st.")).toBeVisible();
    await expect(dock.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
});

test.describe("a 390 px phone, reduced motion", () => {
  test("the dock fits the screen, opens without motion, and the question box stays above the fold", async ({ page }) => {
    // On the page, not `test.use`: the config's options do not carry `reducedMotion` to the context.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signedIn(page, (route) => route.fulfill(sse(ANSWER)));
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Ask AI/ }).click();
    const dock = page.getByRole("dialog", { name: "Ask AI" });
    // Read at once, while Vue's enter classes (`duration-200`) are still on the element: that is the
    // motion the rule must still. Read after the entrance, any duration would pass.
    const duration = await dock.evaluate((el) => getComputedStyle(el).transitionDuration);
    await expect(dock).toBeVisible();

    const box = (await dock.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const question = dock.getByRole("textbox");
    const q = (await question.boundingBox())!;
    expect(q.y + q.height).toBeLessThanOrEqual(844);

    // The app-wide reduced-motion rule (`style.css`) stills the dock's entrance.
    const seconds = duration.split(",").map((d) => (d.trim().endsWith("ms") ? parseFloat(d) / 1000 : parseFloat(d)));
    expect(seconds.every((sec) => sec <= 0.001), duration).toBe(true);

    await question.fill("fuel spend");
    await question.press("Enter");
    await expect(dock.getByText("Fuel spend last month was $41,200.")).toBeVisible();
  });
});
