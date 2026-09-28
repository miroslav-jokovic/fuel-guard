import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { partOneLink, partTwoLink, stubApi, TOKEN, type Stub } from "./stubApi";

/**
 * §6.8's network bar, in a real browser: "network cut mid-screen: zero lost answers; a cut upload is
 * retried from the kept photo, never re-taken" (C3d3b1). One test per device copy the page keeps —
 * Part 1's held screens (C3d1a), Part 2's unsent draft (C3d1b), the photograph (C3d2) — each proved
 * against the production bundle, Chromium's own IndexedDB and a reload, which the unit suites can
 * only imitate with `fake-indexeddb` and a remount.
 *
 * A cut is a dropped connection (`stubApi`'s `cut`, or the browser taken offline), never an error
 * answer: "no signal" is the branch under test.
 */

const url = `/apply/${TOKEN}`;
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Pick an option in one of the page's state comboboxes. */
async function chooseState(page: Page, id: string, typed: string, option: RegExp): Promise<void> {
  await page.locator(id).click();
  await page.locator(id).fill(typed);
  await page.getByRole("option", { name: option }).first().click();
}

/** Screens 3–6 of Part 1, typed. Nothing of them reaches the server until screen 7 (0376, AI009). */
async function typeHeldScreens(page: Page): Promise<void> {
  await page.getByLabel("Mobile phone number").fill("3125550142");
  await page.locator("#p1-dob").fill("03");
  await page.locator("#p1-dob-day").fill("07");
  await page.locator("#p1-dob-year").fill("1985");
  await continueButton(page).click();
  await page.locator("#p1-line1").fill("12 Depot Rd");
  await page.locator("#p1-city").fill("Joliet");
  await chooseState(page, "#p1-state", "Illin", /Illinois/);
  await page.locator("#p1-zip").fill("60432");
  await continueButton(page).click();
  await chooseState(page, "#p1-cdl-state", "Illin", /Illinois/);
  await page.locator("#p1-cdl-number").fill("D12345678901");
  await page.getByLabel("A", { exact: true }).check();
  await page.locator("#p1-cdl-expires").fill("05");
  await page.locator("#p1-cdl-expires-day").fill("01");
  await page.locator("#p1-cdl-expires-year").fill("2029");
  await continueButton(page).click();
  await page.getByLabel("No", { exact: true }).check();
  await continueButton(page).click();
}

/** Screen 7's two questions. Deliberately never kept on the phone (Q-AW39), so asked again after a reload. */
async function answerScreening(page: Page): Promise<void> {
  const noes = page.getByLabel("No", { exact: true });
  await expect(noes).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) await noes.nth(i).check();
}

test("Part 1: a cut connection at screen 7 and a reload lose none of screens 3–6 (C3d1a)", async ({ page }) => {
  const stub = await stubApi(page, partOneLink());
  await page.goto(url);
  await expect(page.getByText("Step 3 of 9")).toBeVisible();
  await typeHeldScreens(page);
  await expect(page.getByText("Step 7 of 9")).toBeVisible();

  // The signal goes as the driver presses Continue on screen 7: the first write fails.
  stub.cut(/\/intake/);
  await answerScreening(page);
  await continueButton(page).click();
  await expect(page.getByText("That did not save. Check your signal and try again.")).toBeVisible();
  await expect(page.getByText("Step 7 of 9")).toBeVisible();

  // The phone is reloaded with the signal back. Screens 3–6 come back from the phone, not the server
  // (which has none of them), and the walk reopens where it was.
  stub.restore();
  const beforeReload = stub.state.calls.length;
  await page.reload();
  await expect(page.getByText("Step 7 of 9")).toBeVisible();
  await answerScreening(page);
  await continueButton(page).click();
  await expect(page.getByText("Step 8 of 9")).toBeVisible();

  // What was typed BEFORE the reload is what the first write carried.
  const [answers, licences, identity] = stub.state.calls
    .slice(beforeReload)
    .filter((c) => c.method === "POST" && /\/intake(\/licences)?$/.test(c.path));
  expect(answers!.body).toMatchObject({ phone: "3125550142", address_line1: "12 Depot Rd", city: "Joliet", state: "IL", postal_code: "60432" });
  expect(licences!.body).toMatchObject({ licences: [expect.objectContaining({ licence_number: "D12345678901", state_code: "IL" })] });
  expect(identity!.body).toMatchObject({ date_of_birth: "1985-03-07" });
});

test("Part 2: an answer typed while saves fail is put back and saved on the next visit (C3d1b)", async ({ page }) => {
  const stub = await stubApi(page, partTwoLink(
    { first_name: "Susan", last_name: "Godfrey", email: "s@example.test", phone: "3125550142" }, 3,
  ));
  await page.goto(url);
  await expect(page.locator("#apply-first_name")).toHaveValue("Susan");

  stub.cut(/\/draft$/);
  await page.locator("#apply-middle_name").fill("Anne");
  await expect(page.getByText(/Not saved — check your signal/)).toBeVisible({ timeout: 15_000 });
  expect(stub.callsTo("PUT", /\/draft$/).length).toBeGreaterThan(0);
  // Nothing reached the server's copy.
  expect(stub.state.draft.revision).toBe(3);

  stub.restore();
  await page.reload();
  await expect(page.getByText(/We put back answers/)).toBeVisible();
  await expect(page.locator("#apply-middle_name")).toHaveValue("Anne");
  // Sent at once, on the revision it was typed on, and the server now holds it.
  await expect.poll(() => stub.state.draft.revision).toBe(4);
  expect(stub.state.draft.payload).toMatchObject({ first_name: "Susan", middle_name: "Anne" });
  const replay = stub.callsTo("PUT", /\/draft$/).at(-1)!;
  expect(replay.body).toMatchObject({ revision: 3 });
});

/** A photograph of a card: textured enough to pass the browser's gate, drawn by Chromium itself. */
async function cardPhoto(page: Page): Promise<Buffer> {
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
    g.fillStyle = "#000";
    g.font = "80px sans-serif";
    g.fillText("ILLINOIS CDL", 200, 300);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

/** Photograph the CDL's front, press "Use this photo", and return the stub. */
async function takeFront(page: Page): Promise<Stub> {
  const stub = await stubApi(page, partOneLink({ captures: [] }));
  await page.goto(url);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Take photo" }).click();
  await (await chooser).setFiles({ name: "cdl.jpg", mimeType: "image/jpeg", buffer: await cardPhoto(page) });
  await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
  return stub;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The confirm the page sent last, and the bytes the upload before it carried. */
function lastConfirm(stub: Stub): { sha256: string; uploaded: Buffer } {
  const confirm = stub.callsTo("PUT", /\/capture\/[^/]+$/).at(-1)!;
  const captureId = confirm.path.split("/").pop()!;
  return { sha256: (confirm.body as { sha256: string }).sha256, uploaded: stub.state.uploads.get(captureId)! };
}

test("a photo whose upload was cut is sent again from the phone after a reload, never taken again (C3d2)", async ({ page }) => {
  const stub = await takeFront(page);
  stub.cut(/^\/__storage\//);
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("That did not send. Check your signal, then press “Use this photo” again.")).toBeVisible();
  const cutAttempt = stub.state.cutBodies.at(-1)!;
  expect(stub.callsTo("PUT", /\/capture\/[^/]+$/)).toHaveLength(0);

  stub.restore();
  let picked = false;
  page.on("filechooser", () => (picked = true));
  await page.reload();
  await expect(page.getByText("Received.")).toBeVisible();
  expect(picked).toBe(false);

  // The same bytes as the attempt that was cut, and the hash the gate took of them.
  const { sha256: confirmed, uploaded } = lastConfirm(stub);
  expect(sha256(uploaded)).toBe(sha256(cutAttempt));
  expect(confirmed).toBe(sha256(uploaded));
});

/**
 * ⚠ The cut is the stub's, and `setOffline` only supplies the browser's `offline`/`online` events: a
 * `page.route` answers ABOVE the network stack, so an offline context still reaches a stubbed route —
 * measured, the first version of this test "went offline" and the photo was received.
 */
test("a photo held while the phone is offline goes by itself when the signal returns (C3d2)", async ({ page, context }) => {
  const stub = await takeFront(page);
  stub.cut(/^\/__storage\//);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("That did not send. Check your signal, then press “Use this photo” again.")).toBeVisible();
  expect(stub.callsTo("PUT", /\/capture\/[^/]+$/)).toHaveLength(0);

  // No press: the page hears `online` and sends the photo it kept.
  stub.restore();
  await context.setOffline(false);
  await expect(page.getByText("Received.")).toBeVisible();
  const { sha256: confirmed, uploaded } = lastConfirm(stub);
  expect(confirmed).toBe(sha256(uploaded));
});
