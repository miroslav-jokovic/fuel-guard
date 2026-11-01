import { expect, test, type Page } from "@playwright/test";
import { CARRIER, partTwoLink, stubApi, TOKEN } from "./stubApi";

/**
 * The applicant form's §9 P8 rules in a real browser (HIRING-WORKFLOW-AUDIT §3.3, AF-1/AF-4/AF-5).
 *
 *   · The review counts what is missing and lists it, one link per answer; Send is refused with the
 *     required ones, nothing reaches the office, and once they are answered Send goes through.
 *   · A job cannot be saved blank, and a half-filled one is listed as unfinished — never a blank row.
 *   · The same list, in Spanish, for an applicant reading the page in Spanish.
 *
 * A legacy link (no Part 1), resumed at the review screen with everything answered but the carrier's
 * `position` (required) and `references` (optional) — so the list holds exactly one of each kind.
 */
const url = `/apply/${TOKEN}`;

const ANSWERS = {
  applying_as: "company_driver", heard_from: "A friend", legally_work: true, proof_of_age: true,
  may_contact_employers: true, military_service: false, other_training: "Doesn't apply",
  education: [{ school: "Joliet High", years_completed: 4, field_of_study: "", graduated: true, graduated_when: "1998" }],
};

const DRAFT = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "", cdl_expires_at: "2029-01-01", additional_licences: [],
  experience: "Eight years, dry van and reefer.", equipment_experience: [],
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_denial_detail: "",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "", address_line1: "",
    city: "", state: "", phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_employment: false,
  questionnaire: ANSWERS,
  questionnaire_version: "silvicom_driver@v3",
};

/** The legacy link, resumed on the review screen. */
function atReview(): Record<string, unknown> {
  const link = partTwoLink(DRAFT, 2);
  return { ...link, draft: { ...(link.draft as Record<string, unknown>), furthestSection: "review" } };
}

const send = (page: Page) => page.getByRole("button", { name: `Send it to ${CARRIER}` });

test("Send is refused with the missing answers listed, each a link to its box, and accepted once they are given", async ({ page }) => {
  const stub = await stubApi(page, atReview());
  await page.goto(url);

  // AF-5: the count and one line per answer, before anything is pressed.
  await expect(page.getByText("2 answers missing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Position you are applying for" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Three personal references" })).toBeVisible();

  // AF-1: Send refuses the required one, and nothing reaches the office.
  await send(page).click();
  await expect(page.getByText("Before you can send this")).toBeVisible();
  expect(stub.callsTo("POST", /\/review$/)).toHaveLength(0);

  // The link goes to the box itself, on the screen it is asked on.
  await page.getByRole("button", { name: "Position you are applying for" }).first().click();
  const position = page.locator("#apply-questionnaire_answers-position");
  await expect(position).toBeFocused();
  await position.fill("Company driver");

  // Back to the review through the step list: only the optional one is left, and Send goes through.
  await page.getByRole("button", { name: /^Step \d+ of \d+/ }).click();
  await page.getByRole("button", { name: /Check your answers/ }).first().click();
  await expect(page.getByText("1 answer missing")).toBeVisible();
  await expect(page.getByText("These are optional. You can send without them.")).toBeVisible();
  await send(page).click();
  await expect.poll(() => stub.callsTo("POST", /\/review$/).length).toBe(1);
  expect(stub.state.unstubbed).toEqual([]);
});

test("a job cannot be saved blank, and a half-filled one is listed as unfinished, never as a blank row", async ({ page }) => {
  const link = partTwoLink(DRAFT, 2);
  await stubApi(page, { ...link, draft: { ...(link.draft as Record<string, unknown>), furthestSection: "employment" } });
  await page.goto(url);
  await expect(page.getByText("Old Carrier")).toBeVisible();

  await page.getByRole("button", { name: "Add another job" }).click();
  await page.getByRole("button", { name: "Save this job" }).click();
  // Refused, in the panel, on both answers the contract requires.
  await expect(page.locator("#apply-employers-1-employer_name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#apply-employers-1-started_on")).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Cancel" }).click();
  // Closed blank: no row.
  await expect(page.locator("li", { hasText: "Unfinished" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add another job" }).click();
  await page.locator("#apply-employers-1-employer_name").fill("Half Carrier");
  await page.getByRole("button", { name: "Cancel" }).click();
  const row = page.locator("li", { hasText: "Half Carrier" });
  await expect(row).toContainText("Unfinished — finish or remove");
  await expect(row.getByRole("button", { name: "Finish" })).toBeVisible();
});

test("the missing list reads in Spanish on a page read in Spanish", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("silvicom-apply-language", "es"));
  await stubApi(page, atReview());
  await page.goto(url);
  await expect(page.getByText("Faltan 2 respuestas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Puesto que solicita" })).toBeVisible();
});
