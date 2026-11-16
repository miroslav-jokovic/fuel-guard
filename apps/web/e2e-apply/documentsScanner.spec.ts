import { expect, test } from "@playwright/test";
import { pastTipsIfShown } from "./liveScanner";
import { CARRIER, stubApi, TOKEN } from "./stubApi";

/**
 * "Your documents" through the in-page scanner (Q-AM25 (a), owner 2026-11-15), in a real browser under
 * production's CSP, with Chromium's fake camera playing a plain card (`cameraFeed.ts`).
 *
 *   · "Take photo" beside a paper opens the scanner, not the phone's camera app, named by that paper.
 *   · The outline is the paper's rough shape: a wallet card for a TWIC, a page for a certificate.
 *   · What is sent is the photograph cut to the outline — smaller than the camera's whole frame — and it
 *     goes to that paper's own slot. The tips come once a visit, as in Part 1.
 */
const url = `/apply/${TOKEN}`;
const BUNDLE = {
  documentsOnly: true, carrier: CARRIER, expiresAt: "2099-01-01T00:00:00Z", localKey: "e2e-local-key-documents-scanner",
  captures: [],
  offeredDocumentSlots: ["twic", "training_certificate"],
  draft: { payload: null },
};

test("Take photo in Your documents opens the scanner for that paper and sends the photo cut to its outline", async ({ page }) => {
  const stub = await stubApi(page, BUNDLE);
  await page.goto(url);
  const row = (slot: string) => page.locator(`[data-document-slot="${slot}"]`);

  // A wallet card.
  await row("twic").getByRole("button", { name: "Take photo", exact: true }).click();
  expect(await pastTipsIfShown(page)).toBe(true);
  await expect(page.locator("[data-live-scanner]")).toBeVisible();
  await expect(page.locator("[data-live-outline]")).toHaveAttribute("data-live-outline", "card");
  await expect(page.locator("[data-live-side]")).toHaveText(/TWIC card/);
  await expect(page.getByText("Fit it inside the corners, then press the button.")).toBeVisible();
  const shutter = page.locator("[data-live-shutter]");
  await expect(shutter).toBeEnabled();
  const video = await page.locator("[data-live-scanner] video").evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight }));
  await shutter.click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await expect(row("twic").getByText("Received", { exact: true })).toBeVisible();

  const confirm = stub.callsTo("PUT", /\/capture\/[^/]+$/).at(-1)!;
  expect(confirm.body).toMatchObject({ slot: "twic", content_type: expect.stringMatching(/^image\/(webp|jpeg)$/) });
  // Cut to the outline: the thumbnail the list shows is the photograph sent, and it is the card's shape,
  // wider than tall, where the camera's whole frame on a phone held upright is not.
  const sent = await row("twic").locator("img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  expect(sent.w / sent.h).toBeGreaterThan(1.3);
  expect(sent.w * sent.h).toBeLessThan(video.w * video.h);

  // A certificate: the same scanner, a page, and no tips the second time this visit.
  await row("training_certificate").getByRole("button", { name: "Take photo", exact: true }).click();
  expect(await pastTipsIfShown(page)).toBe(false);
  await expect(page.locator("[data-live-outline]")).toHaveAttribute("data-live-outline", "page");
  await expect(page.locator("[data-live-side]")).toHaveText(/Training certificate/);
  // Closing it sends nothing and leaves the paper as it was.
  await page.getByRole("button", { name: "Close the camera" }).click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await expect(row("training_certificate").getByRole("button", { name: "Take photo", exact: true })).toBeVisible();
  expect(stub.callsTo("PUT", /\/capture\/[^/]+$/)).toHaveLength(1);
  expect(stub.state.unstubbed).toEqual([]);
});
