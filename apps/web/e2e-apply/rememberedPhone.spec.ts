import { expect, test, type Page } from "@playwright/test";
import { partTwoV2Link, stubApi, STUB_DEVICE_TOKEN, TOKEN } from "./stubApi";

/**
 * The date of birth is asked once per phone (U2, migration 0604), in a real browser with real IndexedDB.
 *
 *   · A right date of birth with "This is my phone" ticked leaves a token on the device; the next visit
 *     sends the token and opens the application without asking.
 *   · Unticked, nothing is kept, and the next visit asks again.
 *
 * The stub answers `/unlock` and `/unlock-device` as the API does (`stubApi.ts`); what is real here is
 * the page, its storage across a reload, and the order of its calls.
 */
const url = `/apply/${TOKEN}`;
const LOCKED = { draft: { locked: true, payload: null, furthestSection: "identity", updatedAt: "2026-09-28T15:00:00.000Z", revision: 1 } };

const dateBox = (page: Page) => page.getByLabel("Your date of birth");
const answer = async (page: Page) => {
  await dateBox(page).fill("04011980");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
};

test("a phone that gave the date of birth once opens the application without being asked again", async ({ page }) => {
  const stub = await stubApi(page, partTwoV2Link(LOCKED));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "This is my phone. Don't ask me again on it." })).toBeChecked();
  await answer(page);
  await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  expect(stub.callsTo("POST", /\/unlock$/).at(-1)!.body).toEqual({ date_of_birth: "1980-04-01", remember_device: true });

  // The second visit: the same phone, the same link.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  await expect(dateBox(page)).toHaveCount(0);
  expect(stub.callsTo("POST", /\/unlock-device$/).map((c) => c.body)).toEqual([{ device_token: STUB_DEVICE_TOKEN }]);
  // Asked once: the date of birth went to the server on the first visit only.
  expect(stub.callsTo("POST", /\/unlock$/)).toHaveLength(1);
  expect(stub.state.unstubbed).toEqual([]);
});

test("a phone that is not the driver's keeps nothing, and the next visit asks again", async ({ page }) => {
  const stub = await stubApi(page, partTwoV2Link(LOCKED));
  await page.goto(url);
  await page.getByRole("checkbox", { name: "This is my phone. Don't ask me again on it." }).uncheck();
  await answer(page);
  await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  expect(stub.callsTo("POST", /\/unlock$/).at(-1)!.body).toEqual({ date_of_birth: "1980-04-01" });

  await page.reload();
  await expect(dateBox(page)).toBeVisible();
  expect(stub.callsTo("POST", /\/unlock-device$/)).toHaveLength(0);
});
