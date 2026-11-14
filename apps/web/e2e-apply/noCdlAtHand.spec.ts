import { expect, test } from "@playwright/test";
import { partOneLink, stubApi, TOKEN } from "./stubApi";

/**
 * "I don't have my CDL with me" (U8, migration 0605), in a real browser.
 *
 *   · Without a photograph and without the answer, Continue stays on the front of the CDL and says why.
 *   · With the answer, both photo screens are passed and the walk goes on to the first question — with no
 *     "Is this right?", because nothing was scanned.
 *   · Nothing is written before screen 7, so only the phone knows: a reload reopens on the question, not
 *     on the photograph.
 */
const url = `/apply/${TOKEN}`;

test("a driver without the card goes on to the questions, and a reload does not send them back to the photo", async ({ page }) => {
  const stub = await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Photo of the front of your CDL" })).toBeVisible();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Photo of the front of your CDL" })).toBeVisible();
  await expect(page.getByRole("alert").first()).toBeVisible();

  await page.getByRole("checkbox", { name: "I don't have my CDL with me" }).check();
  await expect(page.getByText("You will type your license details", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Past BOTH photo screens, and straight to the first question: there is no scan to confirm.
  await expect(page.getByLabel("Mobile phone number")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Is this right?" })).toHaveCount(0);
  expect(stub.callsTo("POST", /\/intake$/)).toHaveLength(0);

  // Reloaded at once: the tick was written to the phone when it was made, not 300 ms later.
  await page.reload();
  await expect(page.getByLabel("Mobile phone number")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Photo of the front of your CDL" })).toHaveCount(0);
  expect(stub.state.unstubbed).toEqual([]);
});
