import { expect, test, type Page } from "@playwright/test";
import { CARRIER, partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * A required answer nobody gave, in a real browser (HIRING-WORKFLOW-AUDIT §3.3, AF-1/AF-5; on the links
 * drivers are sent since 1b-5 began retiring the legacy wizard, 2026-11-14).
 *
 *   · "Before you send" stays shut while a required answer is missing, and says to finish the tasks.
 *   · The task that holds it stops at that question and says so under its box; answered, it goes on.
 *   · Then "Before you send" opens, counts what is still missing and optional, and Send goes through —
 *     once.
 *   · English only (owner 2026-11-13): a phone that chose Spanish before opens in English, with no switch.
 *
 * ⚠ Rewritten from a LEGACY link (no Part 1, the linear wizard resumed on its review screen). There the
 * review could be reached with a required answer missing, and Send refused it; on a current link the
 * list will not open "Before you send" at all, which is the same rule met one screen earlier. The
 * legacy file's second test (a job saved blank in the job panel) is not carried over: the panel is the
 * legacy wizard's, and `employmentWalk.spec.ts` walks a job on a current link.
 */
const url = `/apply/${TOKEN}`;
const T = "2026-09-28T15:00:00.000Z";

/** Everything answered but the carrier's `position` (required); `references` and `other_training` (optional) left. */
const DRAFT = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01", email: "s@example.test", phone: "555-0111",
  addresses: [{ key: "40000000-0000-4000-8000-0000000000a1", line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A", cdl_expires_at: "2029-01-01", additional_licences: [],
  experience: "Eight years, dry van and reefer.", equipment_experience: [],
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_suspended: false, licence_denial_detail: "",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "", address_line1: "", city: "Gary", state: "IN",
    phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "", operated_cmv: true, dot_regulated: true,
    reason_for_leaving: "Better pay", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_employment: false,
  questionnaire: {
    applying_as: "company_driver", heard_from: "A friend", legally_work: true, may_contact_employers: true, military_service: false,
    proof_of_age: true, education: [{ school: "Joliet High", years_completed: 4, field_of_study: "", graduated: true, graduated_when: "1998" }],
  },
  questionnaire_version: "silvicom_driver@v3",
};
const link = () => ({ ...partTwoV2Link(), draft: { locked: false, payload: DRAFT, furthestSection: "identity", updatedAt: T, revision: 2 } });

const send = (page: Page) => page.getByRole("button", { name: `Send it to ${CARRIER}` });
const next = (page: Page) => page.getByRole("button", { name: /^(Continue|Save and continue)$/ }).click();
const beforeYouSend = (page: Page) => page.getByRole("button", { name: /Before you send/ });

test("a required answer keeps 'Before you send' shut until it is given, and then Send goes through once", async ({ page }) => {
  const stub = await stubApi(page, link());
  await page.goto(url);

  // Shut, and it says why.
  await expect(beforeYouSend(page)).toBeDisabled();
  await expect(page.getByText("Finish the tasks above first.")).toBeVisible();

  // The task that holds the answer stops on it, under its own box.
  await page.getByRole("button", { name: /About you/ }).click();
  const position = page.locator("#apply-questionnaire_answers-position");
  for (let i = 0; i < 8 && !(await position.isVisible()); i += 1) await next(page);
  await expect(position).toBeVisible();
  await next(page);
  await expect(page.getByText("Answer this question.")).toBeVisible();
  await expect(position).toBeVisible();

  await position.fill("Company driver");
  for (let i = 0; i < 8 && !(await beforeYouSend(page).isVisible()); i += 1) await next(page);
  await expect(page.getByRole("button", { name: "Open About you, Completed" })).toBeVisible();

  // Open now; what is left is optional, counted, and does not stop the send.
  await expect(beforeYouSend(page)).toBeEnabled();
  await beforeYouSend(page).click();
  await expect(page.getByText(/\d answers? missing/)).toBeVisible();
  await expect(page.getByText("These are optional. You can send without them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Three personal references" })).toBeVisible();
  expect(stub.callsTo("POST", /\/review$/)).toHaveLength(0);
  await send(page).click();
  await expect.poll(() => stub.callsTo("POST", /\/review$/).length).toBe(1);
  expect(stub.state.unstubbed).toEqual([]);
});

test("a phone that chose Spanish before opens in English, with no language switch", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("silvicom-apply-language", "es"));
  await stubApi(page, link());
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
  await expect(page.getByText("Finish the tasks above first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change this page's language" })).toHaveCount(0);
});
