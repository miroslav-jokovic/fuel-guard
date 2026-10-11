import { expect, test, type Page } from "@playwright/test";
import { pastTipsIfShown } from "./liveScanner";
import { partOneLink, stubApi, TOKEN, type Stub } from "./stubApi";

/**
 * The medical card and the selfie through the live scanner (owner, 2026-09-30, Q-AW53), in a real browser
 * under production's CSP, with Chromium's fake camera playing the plain card (`cameraFeed.ts`). Chromium's
 * fake device answers any `facingMode`, so the selfie's front camera is checked by what the page ASKED for.
 */

const url = `/apply/${TOKEN}`;
const DONE = (slot: string) => ({ slot, contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z" });

/** A link whose Part 1 is answered up to the medical card — the CDL's two sides on file, every question saved. */
function atMedicalCard(captures = [DONE("cdl_front"), DONE("cdl_back")]): Record<string, unknown> {
  const link = partOneLink({ captures }) as Record<string, unknown>;
  link.partOne = { ...(link.partOne as object), contact: true, address: true, licences: true, screening: true };
  link.identityComplete = true;
  return link;
}
const atSelfie = () => atMedicalCard([DONE("cdl_front"), DONE("cdl_back"), DONE("medical_card")]);

/** Record every `getUserMedia` request the page makes, before the page runs. */
async function recordCameraRequests(page: Page): Promise<() => Promise<MediaStreamConstraints[]>> {
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const asked: MediaStreamConstraints[] = ((window as unknown as { __asked: MediaStreamConstraints[] }).__asked = []);
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => (asked.push(c ?? {}), real(c));
  });
  return () => page.evaluate(() => (window as unknown as { __asked: MediaStreamConstraints[] }).__asked);
}

/** Shutter, then "Use this photo", then the bytes the stub received for it. */
async function shootAndSend(page: Page, stub: Stub, slot: string): Promise<Buffer> {
  const shutter = page.locator("[data-live-shutter]");
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Received.")).toBeVisible();
  const confirm = stub.callsTo("PUT", /\/capture\/[^/]+$/).at(-1)!;
  expect(confirm.body).toMatchObject({ slot, content_type: expect.stringMatching(/^image\/(webp|jpeg)$/) });
  return stub.state.uploads.get(confirm.path.split("/").pop()!)!;
}

test("the medical card is framed as a page on the rear camera and taken by its shutter", async ({ page }) => {
  const asked = await recordCameraRequests(page);
  const stub = await stubApi(page, atMedicalCard());
  await page.goto(url);
  await expect(page.getByText("Your DOT medical examiner's certificate.")).toBeVisible();

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  // The first document scanner of this visit: the document's tips, under the medical card's own heading.
  await expect(page.locator("[data-live-tips]")).toHaveAttribute("data-live-tips", "document");
  await expect(page.getByRole("heading", { name: "Photograph your medical card" })).toBeVisible();
  await page.getByRole("button", { name: "Open the camera" }).click();

  await expect(page.locator("[data-live-outline]")).toHaveAttribute("data-live-outline", "page");
  await expect(page.locator("[data-live-side]")).toHaveText(/Your DOT medical examiner's certificate/);
  const box = (await page.locator("[data-live-outline]").boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(11 / 8.5, 2);
  await expect(page.locator("video")).not.toHaveAttribute("data-live-mirrored");
  // No barcode on a page: nothing takes it but the shutter, however long the camera looks.
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-live-scanner]")).toBeVisible();

  await shootAndSend(page, stub, "medical_card");
  const video = (await asked()).map((c) => (c.video as MediaTrackConstraints).facingMode);
  expect(video).toEqual([{ ideal: "environment" }]);
});

test("the selfie asks for the front camera, mirrors the preview inside an oval, and saves the photo unmirrored", async ({ page }) => {
  const asked = await recordCameraRequests(page);
  const stub = await stubApi(page, atSelfie());
  await page.goto(url);
  await expect(page.locator("[data-selfie-why]")).toBeVisible();

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.locator("[data-live-tips]")).toHaveAttribute("data-live-tips", "face");
  await expect(page.locator("[data-live-tips]").getByText("Take off sunglasses and a hat.")).toBeVisible();
  await page.getByRole("button", { name: "Open the camera" }).click();

  await expect(page.locator("[data-live-outline]")).toHaveAttribute("data-live-outline", "face");
  await expect(page.locator("[data-live-oval]")).toBeVisible();
  await expect(page.locator("[data-live-side]")).toHaveText(/Your face/);
  // What the browser PAINTED: the preview flipped left-to-right, nothing else about it changed.
  // (Tailwind 4's `-scale-x-100` sets the `scale` property, not `transform`.)
  const painted = await page.locator("video").evaluate((v) => ({ scale: getComputedStyle(v).scale, transform: getComputedStyle(v).transform }));
  expect(painted).toEqual({ scale: "-1 1", transform: "none" });
  await expect(page.locator("[data-live-torch]")).toHaveCount(0);

  const photo = await shootAndSend(page, stub, "selfie");
  const video = (await asked()).map((c) => (c.video as MediaTrackConstraints).facingMode);
  expect(video).toEqual([{ ideal: "user" }]);

  // The fake camera's card has its name, date of birth and class on the LEFT, nothing on the right
  // (`cameraFeed.ts`; looked at, 2026-09-30). Across the rows they occupy in the oval's cut, the ink is on the
  // photograph's left — so it was saved as the camera saw it, not as the mirrored preview showed it.
  const ink = await page.evaluate(async (b64) => {
    // Decoded from the bytes, never fetched: production's connect-src refuses blob: and data: URLs alike.
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))]));
    const c = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    const g = c.getContext("2d")!;
    g.drawImage(bitmap, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    let left = 0;
    let right = 0;
    for (let y = Math.round(height * 0.4); y < Math.round(height * 0.56); y += 1) {
      // Inside the card only: the feed's dark background shows at both of its ends.
      for (let x = Math.round(width * 0.1); x < Math.round(width * 0.9); x += 1) {
        const i = (y * width + x) * 4;
        if (data[i]! + data[i + 1]! + data[i + 2]! >= 240) continue;
        if (x < width / 2) left += 1;
        else right += 1;
      }
    }
    return { left, right };
  }, photo.toString("base64"));
  expect(ink.left).toBeGreaterThan(1000);
  expect(ink.right).toBeLessThan(ink.left / 10);
});

test("the tips are shown once a visit for EACH kind: the selfie's still come after the medical card's", async ({ page }) => {
  const stub = await stubApi(page, atMedicalCard());
  await page.goto(url);
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  expect(await pastTipsIfShown(page)).toBe(true);
  await shootAndSend(page, stub, "medical_card");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator("[data-selfie-why]")).toBeVisible();
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.locator("[data-live-tips]")).toHaveAttribute("data-live-tips", "face");
  await page.getByRole("button", { name: "Open the camera" }).click();
  await shootAndSend(page, stub, "selfie");

  // A retake is the same kind again: straight to the camera.
  await page.getByRole("button", { name: "Take it again" }).click();
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await expect(page.locator("[data-live-tips]")).toHaveCount(0);
});

// The CDL's version of this is in `scanner.spec.ts`; the oval and the page are new surfaces for the same
// mistake — a `text-ink-inverse` losing to a variant's grey — so they are measured the same way.
for (const [slot, link] of [["medical_card", atMedicalCard], ["selfie", atSelfie]] as const) {
  test(`every control on the ${slot} scanner is painted in the panel's light ink, not a grey`, async ({ page }) => {
    await stubApi(page, link());
    await page.goto(url);
    await page.getByRole("button", { name: "Take photo", exact: true }).click();
    const paint = () =>
      page.evaluate(() => {
        const panel = document.querySelector("[data-live-scanner]")!;
        const ink = getComputedStyle(panel).color;
        return [...panel.querySelectorAll("button")]
          .filter((b) => !b.className.includes("bg-action-primary"))
          .map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent?.trim(), light: getComputedStyle(b).color === ink }));
      });
    await expect(page.locator("[data-live-tips]")).toBeVisible();
    expect((await paint()).filter((b) => !b.light)).toEqual([]);
    await page.getByRole("button", { name: "Open the camera" }).click();
    await expect(page.locator("[data-live-shutter]")).toBeEnabled();
    const live = await paint();
    expect(live.map((b) => b.name)).toEqual(expect.arrayContaining(["Close the camera", "Camera app", "Upload a photo"]));
    expect(live.filter((b) => !b.light)).toEqual([]);
  });
}
