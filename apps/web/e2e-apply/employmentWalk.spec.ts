import { expect, test, type Page } from "@playwright/test";
import { partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * "Where you have worked", one question to a screen, in a real browser (F4 PR 1b-4, SCREEN-MAP 2.8–2.17).
 *
 *   · "Have you had a job?" is asked with nothing chosen; Yes walks one job a question at a time.
 *   · The DOT question takes "Not sure", and the driver moves on: the office answers it.
 *   · A gap the jobs leave is asked about on its own screen, with quick picks.
 *   · Equipment is picked, each pick a screen; the last Continue closes the task Completed.
 *
 * The stub serves the carrier's day as 2026-09-28 (`carrierToday`), so the three years open on 09/28/2023.
 */
const url = `/apply/${TOKEN}`;

const next = async (page: Page) => {
  const save = page.getByRole("button", { name: "Save and continue", exact: true });
  await ((await save.count()) ? save : page.getByRole("button", { name: "Continue", exact: true })).click();
};
const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).click();

test("a job is walked a question at a time, Not sure is an answer, the gap is explained, and the task closes Completed", async ({ page }, testInfo) => {
  const stub = await stubApi(page, partTwoV2Link({
    draft: { locked: false, payload: { first_name: "Susan", last_name: "Godfrey" }, furthestSection: "employment", updatedAt: "2026-08-21T09:00:00.000Z", revision: 1 },
  }));
  await page.goto(url);
  await page.getByRole("button", { name: /Where you have worked/ }).click();

  // Nothing chosen, though a new draft holds a blank job.
  await expect(page.getByText(/Have you had a job in the last 3 years/)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).not.toBeChecked();
  await pick(page, "Yes");
  await next(page);

  await next(page);
  await expect(page.locator("#apply-employers-0-employer_name")).toBeFocused();
  await page.getByLabel("What was the company's name?").fill("Midwest Freight");
  await next(page);

  // Where it was: optional, the office completes it.
  await expect(page.getByText("Midwest Freight", { exact: true })).toBeVisible();
  await expect(page.getByText("Where was the company based?")).toBeVisible();
  await next(page);

  await page.getByLabel("When did you start?").fill("06012025");
  await next(page);
  await expect(page.getByText("Did you drive a truck in this job?")).toBeVisible();
  await pick(page, "Yes");
  await next(page);

  await expect(page.getByText("Was it a DOT job?")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("1-dot.png"), fullPage: true });
  await next(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await pick(page, "Not sure");
  await next(page);

  await page.getByRole("button", { name: "Better pay or miles" }).click();
  await expect(page.getByLabel("Why did you leave?")).toHaveValue("Better pay or miles");
  await next(page);

  await expect(page.locator("[data-jobs-coverage]")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("2-another.png"), fullPage: true });
  await pick(page, "No");
  await next(page);

  // 09/28/2023 → 05/31/2025 has no job.
  await expect(page.getByText(/^No job from/)).toBeVisible();
  await next(page);
  await expect(page.getByText(/^Tell us what you were doing from/)).toBeVisible();
  await page.getByRole("button", { name: "School or training" }).click();
  await page.screenshot({ path: testInfo.outputPath("3-gap.png"), fullPage: true });
  await next(page);

  await expect(page.getByText("What have you driven?")).toBeVisible();
  await page.getByRole("checkbox", { name: /semi/i }).first().check();
  await page.screenshot({ path: testInfo.outputPath("4-equipment.png"), fullPage: true });
  await next(page);
  await page.getByLabel("When did you start driving it?").fill("062025");
  await page.getByLabel("About how many miles?").fill("100,000");
  await next(page);
  await next(page);

  // The carrier's own question on this task, then the close.
  await pick(page, "Yes");
  await next(page);

  await expect(page.getByRole("button", { name: "Open Where you have worked, Completed" })).toBeVisible();
  const lastSave = () => stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload: Record<string, unknown> } | undefined;
  await expect.poll(() => (lastSave()?.payload.questionnaire as Record<string, unknown> | undefined)?.may_contact_employers).toBe(true);
  expect(lastSave()!.payload).toMatchObject({
    declares_no_employment: false,
    employers: [{
      employer_name: "Midwest Freight", started_on: "2025-06-01", ended_on: "", position_held: "Driver", operated_cmv: true,
      dot_regulated: null, subject_to_fmcsr: null, safety_sensitive: null, dot_not_sure: true, reason_for_leaving: "Better pay or miles",
    }],
    employment_gaps: [{ explanation: "School or training" }],
    equipment_experience: [{ equipment_class: "tractor_semi_trailer", from: "2025-06" }],
  });
  expect(stub.state.unstubbed).toEqual([]);
});
