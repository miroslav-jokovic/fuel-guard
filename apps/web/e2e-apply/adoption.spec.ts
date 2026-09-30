import { expect, test } from "@playwright/test";
import { partOneLink, stubApi, TOKEN } from "./stubApi";

/**
 * Screen 13's adoption (D-AW15, C3s1), with the signature faces slow to arrive.
 *
 * ── WHY THIS SPEC EXISTS ──────────────────────────────────────────────────────────────────────
 * `tapTargets.spec.ts`'s Part 1 walk failed about one CI run in forty (4 of 173 `typecheck-build`
 * attempts, 2026-09-28 → 09-30) with no adoption POST at all after "Use this". The cause was the app,
 * not the runner: a styled mark's picture is optional (`markRequiredFor`), so the button did not wait
 * for `renderStyledMark`, and a press before `document.fonts.load` resolved staged nothing and
 * recorded it as the rasteriser failing — the paper would have carried typed text in place of the hand
 * the driver chose. On CI the fonts are merely cold; here they are held back 1.5 s, which turns a race
 * lost one run in forty into one lost every run (10 of 10 without the fix, measured 2026-09-30).
 */

const url = `/apply/${TOKEN}`;

test("a styled signature pressed before its font has loaded is still sent, with its initials", async ({ page }) => {
  // Part 1 done, so the page resumes on the rights screen, one press from the ceremony.
  const link = partOneLink({
    captures: ["cdl_front", "cdl_back", "selfie"].map((slot) => ({
      slot, contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z",
    })),
  });
  link.identityComplete = true;
  link.partOne = {
    completedAt: null, contact: true, address: true, licences: true, screening: true,
    medicalCardPending: true, rights: false,
  };
  const stub = await stubApi(page, link);
  // Registered after the stub's own routes, so it is matched first (Playwright walks them last-first).
  await page.route("**/fonts/*.woff2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.goto(url);
  await page.getByRole("button", { name: "I have read this" }).click();
  await expect(page.getByRole("radio", { name: "Choose a style" })).toBeChecked();
  await page.getByRole("textbox").first().fill("Susan Godfrey");
  await page.getByRole("textbox").nth(1).fill("SG");

  // Held while the faces are still on their way — the window the flake pressed into.
  const use = page.getByRole("button", { name: /^Use this/ });
  await expect(use).toBeDisabled();
  await use.click();

  await expect.poll(() => stub.callsTo("POST", /\/adoption$/).length).toBe(2);
  const adopted = stub.callsTo("POST", /\/adoption$/).map((c) => c.body as { kind: string; typed_text: string; png_base64: string });
  expect(adopted.map((a) => [a.kind, a.typed_text])).toEqual([["signature", "Susan Godfrey"], ["initials", "SG"]]);
  for (const a of adopted) expect(Buffer.from(a.png_base64, "base64").subarray(1, 4).toString()).toBe("PNG");
});
