import { expect, test } from "@playwright/test";
import { partTwoLink, stubApi, TOKEN } from "./stubApi";

/**
 * Previous jobs on one timeline, in a real browser (HW5b, HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5, EM-9).
 *
 * A legacy link on the carrier's day 09/28/2026, one job 01/01/2023 – 06/30/2025: the timeline shows
 * the job, the gap from 06/30/2025 to today the filing will ask about, and the 3-year line. The
 * applicant explains the gap, then fills it with a job through "Add a job here" — the one employer
 * form opens with the gap's dates in it — and both reach the server on the draft's own autosave.
 */
const url = `/apply/${TOKEN}`;

const DRAFT = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "", cdl_expires_at: "2029-01-01", additional_licences: [],
  experience: "", equipment_experience: [],
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_denial_detail: "",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "", address_line1: "",
    city: "", state: "", phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_employment: false,
};

type Saved = { employers?: Array<{ employer_name: string; started_on: string; ended_on: string }>; employment_gaps?: Array<{ from: string; explanation: string }> };

test("a job and a gap on the timeline: the gap is explained, then filled with a job from Add a job here", async ({ page }) => {
  const link = partTwoLink(DRAFT, 2);
  const stub = await stubApi(page, { ...link, draft: { ...(link.draft as Record<string, unknown>), furthestSection: "employment" } });
  await page.goto(url);

  const timeline = page.getByTestId("employment-timeline");
  await expect(timeline.locator("[data-job]", { hasText: "Old Carrier" })).toContainText("01/01/2023 – 06/30/2025");
  await expect(timeline).toContainText("3 years ago · 09/28/2023");
  const gap = timeline.locator('[data-gap="2025-06-30"]');
  await expect(gap).toContainText("No job from 06/30/2025 to 09/28/2026");

  // The explanation, in the gap's own box, autosaved with the draft.
  await gap.getByRole("textbox").fill("Looking for work");
  await expect.poll(() => {
    const last = stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload?: Saved } | undefined;
    return last?.payload?.employment_gaps?.[0]?.explanation;
  }).toBe("Looking for work");

  // "Add a job here": the one form, with the gap's dates already in it.
  await gap.getByRole("button", { name: "Add a job here" }).click();
  await expect(page.locator("#apply-employers-1-started_on")).toHaveValue("06/30/2025");
  await page.locator("#apply-employers-1-employer_name").fill("New Carrier");
  // The DOT question is asked, not hidden.
  await expect(page.locator("#apply-employers-1-dot_regulated")).toBeVisible();
  await page.getByRole("button", { name: "Save this job" }).click();

  // Newest first, and the gap is gone because the job closed it.
  const jobs = timeline.locator("[data-job]");
  await expect(jobs.first()).toContainText("New Carrier");
  await expect(jobs.nth(1)).toContainText("Old Carrier");
  await expect(timeline.locator("[data-gap]")).toHaveCount(0);
  await expect.poll(() => {
    const last = stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload?: Saved } | undefined;
    return last?.payload?.employers?.map((e) => [e.employer_name, e.started_on, e.ended_on]);
  }).toEqual([
    ["Old Carrier", "2023-01-01", "2025-06-30"],
    ["New Carrier", "2025-06-30", "2026-09-28"],
  ]);
  expect(stub.state.unstubbed).toEqual([]);
});
