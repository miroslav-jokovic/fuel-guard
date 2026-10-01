import { expect, type Page } from "@playwright/test";

/**
 * Photograph the card under the fake camera through the live scanner, by its shutter (2026-09-30).
 *
 * "Take photo" on a phone opens the scanner now, not the camera app, so every walk that photographs a
 * licence goes this way — which is the point: the walks measure what a driver meets. `onOpen` runs while the
 * scanner is up, for a walk that measures its tap targets. Returns once "Use this photo" is on screen.
 */
export async function shootWithScanner(
  page: Page,
  onOpen?: () => Promise<void>,
  onTips?: () => Promise<void>,
): Promise<void> {
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await pastTipsIfShown(page, onTips);
  const shutter = page.locator("[data-live-shutter]");
  // Enabled only once the camera is live and the outline has enough pixels under it (`useLiveScan.start`).
  await expect(shutter).toBeEnabled();
  if (onOpen) await onOpen();
  await shutter.click();
  await expect(page.locator("[data-live-scanner]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
}

/**
 * The tips come before the FIRST scanner of a visit and never again (`scannerTips.ts`), so a walk meets them
 * once. Waits until either the tips or the live view is up, then presses past the tips if they are there.
 */
export async function pastTipsIfShown(page: Page, onTips?: () => Promise<void>): Promise<boolean> {
  const tips = page.locator("[data-live-tips]");
  await expect(tips.or(page.locator("[data-live-shutter]")).or(page.getByRole("alert"))).toBeVisible();
  if (!(await tips.isVisible())) return false;
  if (onTips) await onTips();
  await page.getByRole("button", { name: "Open the camera" }).click();
  return true;
}

/** A photograph of a card for a file input (the camera app, an upload), textured enough to pass the browser's gate. */
export async function cardPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext("2d")!;
    for (let y = 0; y < 1000; y += 20) {
      for (let x = 0; x < 1600; x += 20) {
        g.fillStyle = `rgb(${(x * 7) % 255},${(y * 3) % 255},${(x + y) % 255})`;
        g.fillRect(x, y, 20, 20);
      }
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}
