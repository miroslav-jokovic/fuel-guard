import { expect, test, type Page } from "@playwright/test";
import { cardPhoto, pastTipsIfShown } from "./liveScanner";
import { partOneLink, stubApi, TOKEN } from "./stubApi";

/**
 * The live licence scanner in a real browser (2026-09-30), served under production's CSP, with Chromium's
 * fake camera pointed at a licence whose back carries the AAMVA standard's own example as a real PDF417
 * (`cameraFeed.ts`, the `scanner` project).
 */

const url = `/apply/${TOKEN}`;
const FRONT_DONE = { slot: "cdl_front", contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z" };

/** Replace `getUserMedia` before the page runs — to refuse, or to answer with a camera of a chosen size. */
async function cameraThat(page: Page, behave: "denies" | "is-640x480" | "is-watched" | "has-a-torch"): Promise<void> {
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
      if (behave === "has-a-torch") {
        // Chromium's fake camera has no light, so this one says it has, and records what it is asked.
        const asked: boolean[] = ((window as unknown as { __torch: boolean[] }).__torch = []);
        const track = s.getVideoTracks()[0]!;
        const caps = track.getCapabilities.bind(track);
        track.getCapabilities = () => ({ ...caps(), torch: true }) as MediaTrackCapabilities;
        track.applyConstraints = async (k?: MediaTrackConstraints) => {
          const set = k?.advanced?.[0] as { torch?: boolean } | undefined;
          if (set?.torch !== undefined) asked.push(set.torch);
        };
      }
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
  // The first scanner of the visit opens on the tips, and asks for the camera only past them.
  expect(await pastTipsIfShown(page)).toBe(true);
  await expect(page.locator("[data-live-side]")).toHaveText(/Back — the side with the barcode/);
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
  await pastTipsIfShown(page);
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
  await pastTipsIfShown(page);
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
  await pastTipsIfShown(page);
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await page.getByRole("button", { name: "Close the camera" }).click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === "ended"))).toBe(true);
  await expect(page.getByRole("button", { name: "Take photo", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Use this photo" })).toHaveCount(0);

  // Opened again on this visit, it goes straight to the camera: the tips are shown once.
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await expect(page.locator("[data-live-tips]")).toHaveCount(0);
});

test("a camera with a light gets the flashlight button, which switches it both ways", async ({ page }) => {
  await cameraThat(page, "has-a-torch");
  await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);

  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await pastTipsIfShown(page);
  const torch = page.locator("[data-live-torch]");
  await expect(torch).toHaveAccessibleName("Turn the flashlight on");
  await torch.click();
  await expect(torch).toHaveAccessibleName("Turn the flashlight off");
  await expect(torch).toHaveAttribute("aria-pressed", "true");
  await torch.click();
  await expect(torch).toHaveAccessibleName("Turn the flashlight on");
  expect(await page.evaluate(() => (window as unknown as { __torch: boolean[] }).__torch)).toEqual([true, false]);
});

test("a camera without a light shows no flashlight button at all", async ({ page }) => {
  await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await pastTipsIfShown(page);
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await expect(page.locator("[data-live-torch]")).toHaveCount(0);
});

// The scanner shipped with its close button and its two ways out in `ghost`'s grey on the dark scrim (about
// 2.6:1), because a `text-ink-inverse` class lost to the variant's own colour — so this measures what the
// browser PAINTED, which is the only place that mistake shows. Every control is the panel's own light ink.
test("every control on the scanner is painted in the panel's light ink, not a grey", async ({ page }) => {
  await stubApi(page, partOneLink({ captures: [] }));
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
