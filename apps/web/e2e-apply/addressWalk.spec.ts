import { expect, test, type Page } from "@playwright/test";
import { partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * "Where you have lived", one question to a screen, in a real browser (F4 PR 1b-3, SCREEN-MAP 2.5–2.6a).
 *
 *   · The home the first visit recorded is shown, and only the month the driver moved in is asked.
 *   · Short of three years, Continue asks for the home before: its address, then its months, with the
 *     month they moved out already filled in. A blank home is refused on its own screen.
 *   · The meter counts the three years as the months are given, and the last Continue closes the task.
 *
 * The stub serves the carrier's day as 2026-09-28 (`carrierToday`), so the three years open in 09/2023.
 */
const url = `/apply/${TOKEN}`;
const HOME = { line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "", to: "" };

/** Continue, or the task's own close when the screen is the last one. */
const next = async (page: Page) => {
  const save = page.getByRole("button", { name: "Save and continue", exact: true });
  await ((await save.count()) ? save : page.getByRole("button", { name: "Continue", exact: true })).click();
};

test("the home lived in now is shown, earlier homes are walked until three years are covered, and the task closes Completed", async ({ page }, testInfo) => {
  const stub = await stubApi(page, partTwoV2Link({
    draft: { locked: false, payload: { first_name: "Susan", last_name: "Godfrey", addresses: [HOME] }, furthestSection: "addresses", updatedAt: "2026-08-21T09:00:00.000Z", revision: 1 },
  }));
  await page.goto(url);
  await page.getByRole("button", { name: /Where you have lived/ }).click();

  // The home on record, shown and not asked again; one question about it.
  await expect(page.locator("[data-current-home]")).toContainText("1 Road");
  await expect(page.locator("[data-current-home]")).toContainText("Joliet, IL 60432");
  const meter = page.locator("[data-address-coverage]");
  await expect(meter).toContainText("0 months of 3 years covered");
  await page.screenshot({ path: testInfo.outputPath("1-moved-in.png"), fullPage: true });

  // Nothing typed: refused here, under its own box.
  await next(page);
  await expect(page.locator("#apply-addresses-0-from")).toBeFocused();

  // 07/2025: fourteen of the thirty-six months.
  await page.getByLabel("When did you move in?").fill("072025");
  await expect(meter).toContainText("1 year 2 months of 3 years covered");
  await next(page);

  // The home before: a blank one is refused, the street and ZIP may be left for the office.
  await expect(page.getByText("Earlier address 1")).toBeVisible();
  await expect(page.getByText("Where did you live before that?")).toBeVisible();
  await next(page);
  await expect(page.locator("#apply-addresses-1-city")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("City").fill("Gary");
  await page.locator("#apply-addresses-1-state").click();
  await page.locator("#apply-addresses-1-state").fill("Indi");
  await page.getByRole("option", { name: /Indiana/ }).click();
  await page.screenshot({ path: testInfo.outputPath("2-earlier-home.png"), fullPage: true });
  await next(page);

  // Its months: the month they moved out is the month the next home began.
  await expect(page.locator("#apply-addresses-1-to")).toHaveValue("07/2025");
  await page.locator("#apply-addresses-1-from").fill("062023");
  await expect(meter).toContainText("All 3 years are covered.");
  await page.screenshot({ path: testInfo.outputPath("3-earlier-months.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeVisible();
  await next(page);

  await expect(page.getByRole("button", { name: "Open Where you have lived, Completed" })).toBeVisible();
  const lastSave = () => stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload: { addresses?: Array<Record<string, unknown>> } } | undefined;
  await expect.poll(() => lastSave()?.payload.addresses?.[1]?.from).toBe("2023-06");
  expect(lastSave()!.payload.addresses).toMatchObject([
    { line1: "1 Road", city: "Joliet", from: "2025-07", to: "" },
    { line1: "", city: "Gary", state: "IN", postal_code: "", from: "2023-06", to: "2025-07" },
  ]);
  expect(stub.state.unstubbed).toEqual([]);
});
