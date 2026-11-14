import { expect, test, type Page } from "@playwright/test";
import { partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * "About you", one question to a screen, in a real browser (F4 PR 1b-2, SCREEN-MAP 2.1–2.4).
 *
 *   · The name is one screen, other names one list, then the email and the SSN with its own save.
 *   · The carrier's page-1 questions follow, one to a screen, from the served definition; a required one
 *     is refused on its own screen, under its own box.
 *   · "How did you hear about us?" offers quick picks; a pick fills the box and files the English words.
 *   · The last Continue closes the task, which the list then shows as Completed.
 */
const url = `/apply/${TOKEN}`;

const next = async (page: Page) => {
  const save = page.getByRole("button", { name: "Save and continue", exact: true });
  await ((await save.count()) ? save : page.getByRole("button", { name: "Continue", exact: true })).click();
};

test("About you is walked a question at a time, the carrier's questions among them, and closes Completed", async ({ page }) => {
  // A v2 draft holds Part 1's date of birth and phone: the server gates it behind the date of birth Part 1
  // recorded (`gatedRelease`), and the unlock lays them in (`applyPartOne`). This stub serves it unlocked.
  const PART_ONE = { first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01", phone: "+13125550142" };
  const stub = await stubApi(page, partTwoV2Link({
    draft: { locked: false, payload: PART_ONE, furthestSection: "identity", updatedAt: "2026-08-21T09:00:00.000Z", revision: 1 },
  }));
  await page.goto(url);
  await page.getByRole("button", { name: /About you/ }).click();

  // The name, typed together; the link's draft already holds it.
  await expect(page.getByLabel("First name")).toHaveValue("Susan");
  await next(page);

  // Other names: one list on one screen, optional.
  await page.getByRole("button", { name: "Add a name" }).click();
  await page.getByLabel(/Any other names you have been known by 1/).fill("Susan Miller");
  await next(page);

  await page.getByLabel("Email").fill("susan@example.test");
  await next(page);

  // The SSN is its own control with its own save; Continue passes it by.
  await expect(page.getByRole("button", { name: "Save my number" })).toBeVisible();
  await next(page);

  // A required question of the carrier's, refused on its own screen.
  await expect(page.getByText("Position you are applying for")).toBeVisible();
  await next(page);
  await expect(page.locator("#apply-questionnaire_answers-position")).toBeFocused();
  await page.locator("#apply-questionnaire_answers-position").fill("Company driver");
  await next(page);

  await page.locator("#apply-questionnaire_answers-applying_as").click();
  await page.getByRole("option", { name: "Company driver" }).click();
  await next(page);

  await page.getByRole("button", { name: "A friend or a driver" }).click();
  await expect(page.locator("#apply-questionnaire_answers-heard_from")).toHaveValue("A friend or a driver");
  await next(page);

  await page.getByRole("radio", { name: "Yes" }).click();
  await next(page);
  await page.getByRole("radio", { name: "Yes" }).click();
  await next(page);

  await expect(page.getByRole("button", { name: "Open About you, Completed" })).toBeVisible();
  const lastSave = () => stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload: Record<string, unknown> } | undefined;
  // The draft keeps the carrier's answers under `questionnaire` (`toDraftPayload`); filing names them `questionnaire_answers`.
  await expect.poll(() => (lastSave()?.payload.questionnaire as Record<string, unknown> | undefined)?.proof_of_age).toBe(true);
  expect(lastSave()!.payload).toMatchObject({
    other_names: ["Susan Miller"],
    email: "susan@example.test",
    questionnaire: { position: "Company driver", applying_as: "company_driver", heard_from: "A friend or a driver", legally_work: true },
  });
  expect(stub.state.unstubbed).toEqual([]);
});
