import { expect, test } from "@playwright/test";
import { partOneLink, partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * The three stages (U1, SCREEN-MAP §1): the first screen says what the application is, and every screen
 * after it says where the driver is among the three visits.
 */
const url = `/apply/${TOKEN}`;

test("a fresh link opens on the three stages, marked at Today, and nothing is asked", async ({ page }, testInfo) => {
  // Nothing begun: no consent, no permission, no draft (`linkHasBeenUsed`).
  const link = partOneLink();
  await stubApi(page, { ...link, phases: { ...(link.phases as Record<string, unknown>), consentedAt: null } });
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "What this involves" })).toBeVisible();
  const rows = page.locator("[data-stages] li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("1. Today");
  await expect(rows.nth(1)).toContainText("2. Your history");
  await expect(rows.nth(2)).toContainText("signing link to your phone");
  await expect(page.locator("[data-apply-stages] li[aria-current=step]")).toContainText("Today");
  await expect(page.locator("input, select, textarea")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("intro.png"), fullPage: true });
});

test("the application's own visit is marked Your history, with Today behind it", async ({ page }, testInfo) => {
  await stubApi(page, partTwoV2Link());
  await page.goto(url);
  const bar = page.locator("[data-apply-stages] li");
  await expect(bar.nth(0)).toHaveAttribute("data-state", "done");
  await expect(bar.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(bar.nth(2)).toHaveAttribute("data-state", "ahead");
  await page.screenshot({ path: testInfo.outputPath("hub.png"), fullPage: true });
});
