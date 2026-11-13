import { expect, test, type Page } from "@playwright/test";
import { partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * "Your driving record", one question to a screen, in a real browser (F4 PR 1b-1, SCREEN-MAP 2.18–2.21).
 *
 *   · Each gate is asked with nothing chosen; Yes walks the row's screens, then "Any other?".
 *   · Continue refuses the screen in front of the driver only, under its own box.
 *   · The last Continue closes the task, which the list then shows as Completed.
 *   · On a page read in Spanish the questions and the quick picks are Spanish, and a pick files English.
 */
const url = `/apply/${TOKEN}`;

const yes = (page: Page) => page.getByRole("radio", { name: /^(Yes|Sí)$/ }).click();
const no = (page: Page) => page.getByRole("radio", { name: /^No$/ }).click();
const next = (page: Page, name = "Continue") => page.getByRole("button", { name, exact: true }).click();

test("a clean record with one accident is walked a question at a time and closes Completed", async ({ page }) => {
  const stub = await stubApi(page, partTwoV2Link());
  await page.goto(url);
  await page.getByRole("button", { name: /Your driving record/ }).click();

  await expect(page.getByText("Question 1 of 4")).toBeVisible();
  // Nothing chosen: Continue refuses this screen, and says why under it.
  await next(page);
  await expect(page.locator("#apply-accidents")).toBeFocused();
  await yes(page);
  await next(page);

  await expect(page.getByText("Accident 1")).toBeVisible();
  await page.getByLabel("When was the accident?").fill("04022025");
  await next(page);
  await page.getByLabel("What happened?").fill("Rear-ended at a light");
  await next(page);
  await page.getByLabel("How many people died?").fill("0");
  await page.getByLabel("How many people were hurt?").fill("1");
  await next(page);
  await expect(page.getByText("Were hazardous materials spilled?")).toBeVisible();
  await no(page);
  await next(page);
  await expect(page.getByText("Were you in any other accident in the last 3 years?")).toBeVisible();
  await no(page);
  await next(page);

  for (const question of [/convicted of breaking a traffic law/, /denied a license/, /suspended or revoked/]) {
    await expect(page.getByText(question).first()).toBeVisible();
    await no(page);
    await next(page, (await page.getByRole("button", { name: "Save and continue" }).count()) ? "Save and continue" : "Continue");
  }

  // Back on the list, the task Completed — and the answers reached the server as the driver gave them.
  await expect(page.getByRole("button", { name: "Open Your driving record, Completed" })).toBeVisible();
  // Autosave is debounced: wait for the save that carries the last answer.
  const lastSave = () => stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload: Record<string, unknown> } | undefined;
  await expect.poll(() => lastSave()?.payload.licence_suspended).toBe(false);
  const saved = lastSave()!;
  expect(saved.payload.accidents).toMatchObject([{ occurred_on: "2025-04-02", nature: "Rear-ended at a light", fatalities: "0", injuries: "1", hazmat_spill: false }]);
  expect(saved.payload).toMatchObject({ declares_no_violations: true, licence_ever_denied: false, licence_suspended: false });
  expect(stub.state.unstubbed).toEqual([]);
});

test("the Spanish page asks in Spanish, and a quick pick files the English word", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("silvicom-apply-language", "es"));
  const stub = await stubApi(page, partTwoV2Link());
  await page.goto(url);
  await page.getByRole("button", { name: /Su historial de manejo|historial/i }).first().click();

  await no(page);
  await next(page, "Continuar");
  await yes(page);
  await next(page, "Continuar");
  await expect(page.getByText("Condena 1")).toBeVisible();
  await page.getByLabel("¿Cuándo lo condenaron?").fill("01102025");
  await next(page, "Continuar");
  await page.getByRole("button", { name: "Exceso de velocidad" }).click();
  // Shown in Spanish, filed in English (U7).
  await expect(page.getByLabel("¿Por qué fue?")).toHaveValue("Exceso de velocidad");
  await expect.poll(() => {
    const last = stub.callsTo("PUT", /\/draft$/).at(-1)?.body as { payload?: { violations?: Array<{ offence: string }> } } | undefined;
    return last?.payload?.violations?.[0]?.offence;
  }).toBe("Speeding");
});
