import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signInAsDispatcher } from "./session";
import { installStub } from "./stub";

/**
 * The discovery step (`README.md` §2): opens each page as the synthetic dispatcher and writes what an
 * agent needs to propose a scenario — the page's accessibility tree (roles and names, which is what a
 * scenario's locators are written against) and a screenshot — to `out/discover/`.
 *
 * `TUTORIAL_DISCOVER=/assignments,/loads` picks the pages; it runs only when that is set, so
 * `tutorials:check` never pays for it.
 */
const pages = (process.env.TUTORIAL_DISCOVER ?? "").split(",").filter(Boolean);
const OUT = path.resolve(import.meta.dirname, "out/discover");

test.skip(pages.length === 0, "Set TUTORIAL_DISCOVER to a comma-separated list of paths.");

for (const route of pages) {
  test(`discover ${route}`, async ({ context, page, baseURL }) => {
    await signInAsDispatcher(context);
    const stub = await installStub(context, baseURL!);
    await page.goto(route, { waitUntil: "load" });
    await expect(page.locator("main")).toBeVisible();
    // Long enough for every first read and the map's first tiles; this is a look, not a test.
    await page.waitForTimeout(4000);
    const name = route.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "root";
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${name}.aria.yml`), await page.locator("body").ariaSnapshot());
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    fs.writeFileSync(path.join(OUT, `${name}.requests.json`), JSON.stringify({ unstubbed: stub.unstubbed, refusedWrites: stub.refusedWrites }, null, 2));
  });
}
