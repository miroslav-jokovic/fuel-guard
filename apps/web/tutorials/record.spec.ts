import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { Director, installOverlay } from "./director";
import { OUT_ROOT } from "./paths";
import { readManifest } from "./produce/narration";
import { TUTORIALS } from "./scenarios";
import { signInAsDispatcher } from "./session";
import { installStub } from "./stub";

/**
 * One test per approved tutorial. `TUTORIAL_MODE=record` films it (`make.ts` sets this); the default,
 * `check`, plays every action and assertion with no camera and no pauses — the fast proof that a
 * dashboard change has not broken a tutorial, and what to run before regenerating any video.
 *
 * `TUTORIAL_ONLY=loads,live-map` narrows the run.
 */
const mode = process.env.TUTORIAL_MODE === "record" ? "record" : "check";
const only = (process.env.TUTORIAL_ONLY ?? "").split(",").filter(Boolean);

for (const tutorial of TUTORIALS) {
  if (tutorial.status !== "approved") continue;
  if (only.length && !only.includes(tutorial.id)) continue;

  test(`${tutorial.id}`, async ({ context, page, baseURL }) => {
    const outDir = path.join(OUT_ROOT, tutorial.id);
    fs.mkdirSync(outDir, { recursive: true });
    await signInAsDispatcher(context);
    const stub = await installStub(context, baseURL!, { allowWrites: tutorial.allowWrites });
    await installOverlay(page);

    await page.goto(tutorial.start, { waitUntil: "load" });
    const director = new Director(page, { mode, outDir, narration: readManifest(path.join(outDir, "narration.json")) });
    // The first step's expect is what proves the page has drawn; give the map its tiles before filming.
    await tutorial.chapters[0]!.steps[0]!.expect(page);
    if (mode === "record") {
      await page.waitForTimeout(2500);
      await page.screencast.start({ path: path.join(outDir, "raw.webm"), size: { width: 1920, height: 1080 } });
    }
    try {
      await director.play(tutorial);
    } finally {
      if (mode === "record") await page.screencast.stop();
    }
    fs.writeFileSync(path.join(outDir, "timeline.json"), JSON.stringify({ id: tutorial.id, mode, steps: director.timeline }, null, 2));
    stub.assertClean();
  });
}
