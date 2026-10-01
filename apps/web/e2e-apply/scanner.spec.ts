import { expect, test, type Page } from "@playwright/test";
import { cardPhoto } from "./liveScanner";
import { partOneLink, stubApi, TOKEN } from "./stubApi";

/**
 * The live licence scanner in a real browser (2026-09-30), served under production's CSP, with Chromium's
 * fake camera pointed at a licence whose back carries the AAMVA standard's own example as a real PDF417
 * (`cameraFeed.ts`, the `scanner` project).
 */

const url = `/apply/${TOKEN}`;
const FRONT_DONE = { slot: "cdl_front", contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z" };

/** Replace `getUserMedia` before the page runs — to refuse, or to answer with a camera of a chosen size. */
async function cameraThat(page: Page, behave: "denies" | "is-640x480" | "is-watched"): Promise<void> {
  await page.addInitScript((behave) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (behave === "denies") throw new DOMException("Permission denied", "NotAllowedError");
      if (behave === "is-640x480") {
        const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 480 });
        canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
        const s = canvas.captureStream(15);
        w.__tracks.push(...s.getTracks());
        return s;
      }
      const s = await real(c);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  }, behave);
}

test("the back takes itself once its barcode reads, and what it read fills Part 1", async ({ page }) => {
  const stub = await stubApi(page, partOneLink({ captures: [FRONT_DONE] }));
  await page.goto(url);
  await expect(page.getByText("The side with the barcode.")).toBeVisible();

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.locator("[data-live-scanner]")).toBeVisible();
  // No shutter pressed: the scanner closes itself on the frame whose barcode read.
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Received.")).toBeVisible();

  // The kept photograph is read again for its barcode (`usePartOne`) — so the photo itself is legible —
  // and the standard's example lands in the next screens.
  await expect(page.getByText(/We read your licence's barcode and filled in/)).toBeVisible({ timeout: 15_000 });
  const upload = stub.callsTo("PUT", /\/capture\/[^/]+$/).at(-1)!;
  expect(upload.body).toMatchObject({ slot: "cdl_back", content_type: expect.stringMatching(/^image\/(webp|jpeg)$/) });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#p1-dob-year")).toHaveValue("1986");
});

test("a camera the phone refuses sends the driver to the camera app, and the page stops offering the scanner", async ({ page }) => {
  await cameraThat(page, "denies");
  await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Camera access is off for this page" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Use the camera app instead" }).click();
  await (await chooser).setFiles({ name: "cdl.jpg", mimeType: "image/jpeg", buffer: await cardPhoto(page) });
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Received.")).toBeVisible();

  // Taking it again goes straight to the camera app: the scanner said it cannot run here.
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Take it again" }).click();
  await again;
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
});

test("a camera with too few pixels under the outline is refused before the driver aims", async ({ page }) => {
  await cameraThat(page, "is-640x480");
  await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.getByText(/too few pixels on this page/)).toBeVisible();
  await expect(page.locator("[data-live-shutter]")).toHaveCount(0);
  // And its camera is already let go — nothing is kept running behind a refusal.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState))).toEqual(["ended"]);
});

test("closing the scanner turns the camera off and leaves the screen as it was", async ({ page }) => {
  await cameraThat(page, "is-watched");
  await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await page.getByRole("button", { name: "Close the camera" }).click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === "ended"))).toBe(true);
  await expect(page.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Use this photo" })).toHaveCount(0);
});
