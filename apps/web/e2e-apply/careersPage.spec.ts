import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { SMS_APPLY_PAGE_CONSENT } from "@silvicom/shared";
import { ORIGIN } from "./stubApi";

/**
 * The public careers pages in a real browser (APPLY-PAGE-PLAN AP3, D-AP7), on the BUILT app under production's CSP
 * (`serveWebDist.ts`), against a stubbed `/api/public/careers` answering raw JSON as the API does.
 *
 * What only a browser can show:
 *   · the CSP admits Cloudflare's script, and the token it hands back travels with the form (a stand-in for
 *     `api.js` is served from Cloudflare's own origin by `page.route`, so nothing leaves the machine);
 *   · the page is usable, and axe finds nothing at WCAG 2.2 AA, at a phone's size and a desktop's;
 *   · every control is at least 24 px, WCAG 2.5.8's minimum, and the layout makes them 44 (D-AP7).
 *
 * Every other origin is refused, as `stubApi.ts` does, so a request nobody stubbed fails loudly.
 */
const OPENING = "60000000-0000-4000-8000-000000000001";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // Cloudflare's documented dummy token
const BODY = SMS_APPLY_PAGE_CONSENT.body.replace("{{carrier}}", "Silvicom Inc");
const LIST = {
  carrier: "Silvicom Inc", handle: "silvicom",
  openings: [{ id: OPENING, title: "Regional dry van", pay: { per: "mile", min_cents: 60, max_cents: 75 }, areaLabel: "Chicago, IL", equipment: ["dry_van"], schedule: "regional" }],
  accommodation: { email: "recruiting@silvicominc.com", phone: null },
  pageUrl: `${ORIGIN}/careers/silvicom`, legalOrigin: "https://360.example.test",
};
const job = (siteKey: string | null) => ({
  carrier: "Silvicom Inc", handle: "silvicom",
  opening: {
    id: OPENING, title: "Regional dry van", areaLabel: "Chicago, IL",
    facts: { pay: { per: "mile", min_cents: 60, max_cents: 75 }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null, benefits: ["health insurance"], bonus: null, schedule: "regional", in_our_words: null },
  },
  requirements: { minAge: 23, minClassAYears: 2, hazmat: "off" },
  questions: [
    { key: "class_a_held", label: "Do you hold a valid Class A CDL?", options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] },
    { key: "class_a_years", label: "How many years of Class A driving do you have?", options: [{ key: "lt_1", label: "Less than 1" }, { key: "1_2", label: "1–2" }, { key: "2_plus", label: "More than 2" }] },
  ],
  consent: { version: SMS_APPLY_PAGE_CONSENT.version, title: SMS_APPLY_PAGE_CONSENT.title, body: BODY },
  accommodation: { email: "recruiting@silvicominc.com", phone: null },
  formToken: "sealed", turnstileSiteKey: siteKey,
  pageUrl: `${ORIGIN}/careers/silvicom/jobs/${OPENING}`, legalOrigin: "https://360.example.test",
});

/** A stand-in for Turnstile's `api.js`: renders a box and hands back the dummy token, as Managed mode does for a person. */
const FAKE_TURNSTILE = `window.turnstile = {
  render(el, o) { window.__turnstile = o; const b = document.createElement("div"); b.textContent = "Success!"; el.appendChild(b); setTimeout(() => o.callback(${JSON.stringify(TOKEN)}), 50); return "w1"; },
  reset() {}, remove() {},
};`;

async function stub(page: Page, siteKey: string | null) {
  const posts: unknown[] = [];
  await page.route((url) => url.origin !== ORIGIN && url.origin !== "https://challenges.cloudflare.com", (route) => route.abort("blockedbyclient"));
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }));
  await page.route(`${ORIGIN}/api/public/careers/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    const body = path.endsWith(`/jobs/${OPENING}`) ? job(siteKey) : path === "/api/public/careers/silvicom" ? LIST : null;
    return route.fulfill({ status: body ? 200 : 404, contentType: "application/json", body: JSON.stringify(body ?? { error: { code: "not_found", message: "x" } }) });
  });
  return posts;
}

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** axe-core at WCAG 2.2 AA, run through the debugger protocol so the page's own CSP (no inline script) does not refuse it. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  const ids = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => `${v.id}: ${JSON.stringify(v.nodes.map((n) => n.target))}`);
  });
  return ids;
}

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`${size.width}×${size.height}: list → job → form with the robot check → sent, with no axe violation on either page`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    const posts = await stub(page, "1x00000000000000000000AA");
    await page.goto("/careers/silvicom");
    await expect(page.getByRole("heading", { level: 1, name: "Driving jobs at Silvicom Inc" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("list.png"), fullPage: true });

    await page.getByRole("link", { name: "Regional dry van" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Regional dry van" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${ORIGIN}/careers/silvicom/jobs/${OPENING}`);
    await expect(page.locator("[data-turnstile]")).toContainText("Success!");
    expect(await page.evaluate(() => (window as unknown as { __turnstile: { action: string; sitekey: string } }).__turnstile))
      .toMatchObject({ action: "apply", sitekey: "1x00000000000000000000AA" });
    expect(await axeViolations(page)).toEqual([]);

    // Every control a person presses is at least WCAG 2.5.8's 24 px; the applicant's layout makes them 44 (D-AP7).
    for (const box of await page.locator("[data-careers-form] input:not([tabindex='-1']), [data-careers-form] button, [data-careers-form] a").evaluateAll(
      (els) => els.map((e) => { const r = (e.closest("label") ?? e).getBoundingClientRect(); return { h: r.height, name: e.getAttribute("name") ?? e.textContent }; }),
    )) expect(box.h, String(box.name)).toBeGreaterThanOrEqual(24);

    await page.getByLabel("Full name").fill("Pat Driver");
    await page.getByLabel("Mobile number").fill("(708) 555-0142");
    await page.getByRole("group", { name: "Do you hold a valid Class A CDL?" }).getByText("Yes").click();
    await page.getByRole("group", { name: "How many years of Class A driving do you have?" }).getByText("More than 2").click();
    await expect(page.locator("[data-sms-box] input[type=checkbox]")).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("form.png"), fullPage: true });
    await page.getByRole("button", { name: "Send my application" }).click();

    await expect(page.getByRole("heading", { name: "Application sent" })).toBeFocused();
    expect(posts).toEqual([{
      formToken: "sealed", fullName: "Pat Driver", phone: "(708) 555-0142", email: null,
      answers: { class_a_held: "yes", class_a_years: "2_plus" }, smsOptIn: false, turnstileToken: TOKEN, company_website: "",
    }]);
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("a server with no Turnstile keys draws no widget, loads no Cloudflare script, and still takes the application", async ({ page }) => {
  const posts = await stub(page, null);
  const cloudflare: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith("https://challenges.cloudflare.com")) cloudflare.push(r.url()); });
  await page.goto(`/careers/silvicom/jobs/${OPENING}`);
  await expect(page.getByRole("heading", { level: 1, name: "Regional dry van" })).toBeVisible();
  await expect(page.locator("[data-turnstile]")).toHaveCount(0);
  await page.getByLabel("Full name").fill("Pat Driver");
  await page.getByLabel("Email").fill("pat@example.com");
  await page.getByRole("group", { name: "Do you hold a valid Class A CDL?" }).getByText("Yes").click();
  await page.getByRole("group", { name: "How many years of Class A driving do you have?" }).getByText("1–2").click();
  await page.getByRole("button", { name: "Send my application" }).click();
  await expect(page.getByRole("heading", { name: "Application sent" })).toBeVisible();
  expect((posts[0] as { turnstileToken: unknown }).turnstileToken).toBeNull();
  expect(cloudflare).toEqual([]);
});

test("a careers handle that is off reads as not available", async ({ page }) => {
  await stub(page, null);
  await page.goto("/careers/nobody");
  await expect(page.getByRole("heading", { level: 1, name: "This page is not available" })).toBeVisible();
});
