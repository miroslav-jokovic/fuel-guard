import { expect, test } from "@playwright/test";
import { CARRIER, partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * The office sent one question back (F5, migration 0607), in a real browser: the driver's whole loop.
 *
 *   · With a question open, the handed-over application opens on the question, not on the wait screen.
 *   · "Open my answer" lands in the application, on the screen that asks that answer, with the office's
 *     words above it; "Send my answer" is not offered before that.
 *   · The changed answer is saved as any answer is; "Send my answer" closes the question, and the page
 *     is the wait screen again.
 */
const url = `/apply/${TOKEN}`;
const T = "2026-09-28T15:00:00.000Z";
const QUESTION = { id: "q1", path: ["experience"], question: "How many years did you pull a flatbed?", askedAt: T, answeredAt: null, withdrawnAt: null };

test("a driver answers the office's question and goes back to waiting", async ({ page }) => {
  const link = partTwoV2Link({ phases: { reviewRequestedAt: T } });
  const stub = await stubApi(page, {
    ...link, askAgain: [QUESTION],
    draft: { locked: false, payload: { first_name: "Susan", last_name: "Godfrey", experience: "Eight years, dry van." }, furthestSection: "review", updatedAt: T, revision: 1 },
  });
  await page.goto(url);

  await expect(page.getByRole("heading", { name: `${CARRIER} has a question for you` })).toBeVisible();
  await expect(page.getByText("How many years did you pull a flatbed?")).toBeVisible();
  // Not before the answer was opened.
  await expect(page.getByRole("button", { name: "Send my answer" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open my answer" }).click();
  await expect(page.locator("[data-ask-again-banner]")).toContainText("How many years did you pull a flatbed?");
  const box = page.locator("#apply-experience");
  await expect(box).toBeVisible();
  await expect(box).toHaveValue("Eight years, dry van.");
  await box.fill("Eight years, dry van. Two of them on a flatbed.");
  await page.getByRole("button", { name: "Done — back to the question" }).click();

  await page.getByRole("button", { name: "Send my answer" }).click();
  // Waiting again: the question is closed.
  await expect(page.getByRole("heading", { name: "They have your application" })).toBeVisible();
  // The answer reached the server BEFORE the office was told.
  const calls = stub.state.calls.map((c) => `${c.method} ${c.path.replace(`/${TOKEN}`, "")}`);
  const saved = calls.lastIndexOf("PUT /draft");
  const told = calls.indexOf("POST /ask-again/q1/answer");
  expect(saved).toBeGreaterThanOrEqual(0);
  expect(told).toBeGreaterThan(saved);
  const body = stub.callsTo("PUT", /\/draft$/).at(-1)!.body as { payload: { experience: string } };
  expect(body.payload.experience).toBe("Eight years, dry van. Two of them on a flatbed.");
  expect(stub.state.unstubbed).toEqual([]);
});

test("a question about a job opens that job, not the first one", async ({ page }) => {
  const job = (key: string, employer_name: string, started_on: string, ended_on: string) => ({
    key, employer_name, usdot_number: "", address_line1: "", city: "", state: "", phone: "", email: "", position_held: "Driver",
    started_on, ended_on, operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better pay", subject_to_fmcsr: true, safety_sensitive: true,
  });
  const KEY_B = "40000000-0000-4000-8000-00000000000b";
  const link = partTwoV2Link({ phases: { reviewRequestedAt: T } });
  await stubApi(page, {
    ...link,
    askAgain: [{ id: "q2", path: ["employers", KEY_B], question: "Which terminal did you run out of?", askedAt: T, answeredAt: null, withdrawnAt: null }],
    draft: {
      locked: false, furthestSection: "review", updatedAt: T, revision: 1,
      payload: {
        first_name: "Susan", last_name: "Godfrey", declares_no_employment: false,
        employers: [job("40000000-0000-4000-8000-00000000000a", "Newer Freight", "2025-07-01", ""), job(KEY_B, "Old Carrier", "2023-01-01", "2025-06-30")],
      },
    },
  });
  await page.goto(url);
  // Named by the company, never by the key.
  await expect(page.getByText("About: Old Carrier", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open my answer" }).click();
  await expect(page.locator("[data-ask-again-banner]")).toContainText("Which terminal did you run out of?");
  await expect(page.locator("#apply-employers-1-employer_name")).toHaveValue("Old Carrier");
});

