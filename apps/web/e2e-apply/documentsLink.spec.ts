import { expect, test } from "@playwright/test";
import { CARRIER, stubApi, TOKEN } from "./stubApi";

/**
 * The documents-only link (Q-AM19, migration 0608), in a real browser, against the built page.
 *
 *   · It opens on the photo list: no stage bar, no date-of-birth question, no Send.
 *   · The page asks the server for the link's bundle and nothing else — in particular not the draft,
 *     which this link could not read anyway.
 *   · What is already photographed shows as received.
 */
const url = `/apply/${TOKEN}`;
const BUNDLE = {
  documentsOnly: true, carrier: CARRIER, expiresAt: "2099-01-01T00:00:00Z", localKey: "e2e-local-key-documents",
  captures: [{ slot: "cdl_front", ordinal: 0, contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z" }],
  offeredDocumentSlots: ["medical_card", "twic", "passport"],
};

test("a documents link opens on the photo list and nothing else", async ({ page }) => {
  const stub = await stubApi(page, { ...BUNDLE, draft: { payload: null } });
  await page.goto(url);

  await expect(page.getByRole("heading", { name: `Photos for ${CARRIER}` })).toBeVisible();
  await expect(page.locator('[data-document-slot="medical_card"]')).toBeVisible();
  await expect(page.locator('[data-document-slot="cdl_front"]')).toBeVisible();
  await expect(page.getByText("This link works until", { exact: false })).toBeVisible();

  // The list's own introduction speaks of sending the application, which this link cannot do.
  await expect(page.getByText("stop you sending the application", { exact: false })).toHaveCount(0);
  // ⚠ A name is never squeezed under its buttons: each name keeps its width, and the buttons sit below it
  // on a phone. Found in a 390 px screenshot, where "Medical examiner's certificate" read "Medi / exam / certi".
  for (const slot of ["medical_card", "twic", "passport"]) {
    const row = page.locator(`[data-document-slot="${slot}"]`);
    const name = await row.locator("p.font-medium").first().boundingBox();
    const button = await row.getByRole("button", { name: "Take photo" }).boundingBox();
    expect(name!.width).toBeGreaterThanOrEqual(170);
    const overlap = name!.x < button!.x + button!.width && button!.x < name!.x + name!.width
      && name!.y < button!.y + button!.height && button!.y < name!.y + name!.height;
    expect(overlap).toBe(false);
  }

  // Nothing of the application: no stages, no date of birth, no task list, no Send.
  await expect(page.getByRole("list", { name: "Your application, in three stages" })).toHaveCount(0);
  await expect(page.getByLabel("Your date of birth")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Before you send|Send it to/ })).toHaveCount(0);

  const asked = [...new Set(stub.state.calls.map((c) => `${c.method} ${c.path.replace(`/${TOKEN}`, "") || "/"}`))];
  expect(asked).toEqual(["GET /"]);
  expect(stub.state.unstubbed).toEqual([]);
});
