import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TUTORIAL_DIST } from "../playwright.tutorials.config";
import { produce } from "./produce/compose";
import { voiceLines, type NarrationManifest } from "./produce/narration";
import { OUT_ROOT } from "./paths";
import { TUTORIALS } from "./scenarios";
import { TUTORIAL_SUPABASE_URL } from "./session";

/**
 * `pnpm --filter @silvicom/web tutorials [id …] [--check]` — the whole pipeline, in order:
 *
 *   1. build    the production bundle with every `VITE_*` value pinned (no `.env` can leak in)
 *   2. voice    each line, cached by its text (`produce/narration.ts`, `TUTORIAL_VOICE`)
 *   3. record   in Chromium at 1920×1080, paced by the voice (`record.spec.ts`, `director.ts`)
 *   4. compose  the MP4, captions and written instructions (`produce/compose.ts`)
 *
 * `--check` stops after a fast, camera-less run of every step and assertion — what to run after a
 * dashboard change, before deciding whether any video needs regenerating.
 *
 * Output lands in `tutorials/out/<id>/` (gitignored): `<id>.mp4`, `captions.srt|vtt`,
 * `instructions.md`, `steps/*.jpg`, plus the raw recording and its timeline.
 */
const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.filter((a) => !a.startsWith("--"));
const chosen = TUTORIALS.filter((t) => t.status === "approved" && (wanted.length === 0 || wanted.includes(t.id)));
const unknown = wanted.filter((w) => !TUTORIALS.some((t) => t.id === w));
if (unknown.length) throw new Error(`No tutorial called ${unknown.join(", ")}. Known: ${TUTORIALS.map((t) => t.id).join(", ")}`);
const proposed = TUTORIALS.filter((t) => t.status === "proposed" && wanted.includes(t.id));
if (proposed.length) console.warn(`[tutorials] skipped, still proposed (flip to "approved" first): ${proposed.map((t) => t.id).join(", ")}`);

const WEB = path.resolve(import.meta.dirname, "..");
const run = (cmd: string, argv: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, argv, { cwd: WEB, stdio: "inherit", env: { ...process.env, ...env } });

console.log("[tutorials] 1/4 build");
run("pnpm", ["exec", "vite", "build", "--outDir", TUTORIAL_DIST, "--emptyOutDir"], {
  VITE_SUPABASE_URL: TUTORIAL_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: "tutorial-anon-key",
  VITE_API_URL: "",
  VITE_DEV_BYPASS: "false",
  VITE_APP_ENVIRONMENT: "",
  VITE_SENTRY_DSN: "",
});

const only = chosen.map((t) => t.id).join(",");
if (check) {
  console.log("[tutorials] check: every step and assertion, no camera");
  run("pnpm", ["exec", "playwright", "test", "-c", "playwright.tutorials.config.ts", "record"], { TUTORIAL_MODE: "check", TUTORIAL_ONLY: only });
  process.exit(0);
}

console.log(`[tutorials] 2/4 voice (${process.env.TUTORIAL_VOICE ?? "say"})`);
const manifests = new Map<string, NarrationManifest>();
for (const t of chosen) {
  const manifest = voiceLines(t.chapters.flatMap((c) => c.steps.map((s) => s.say)));
  const dir = path.join(OUT_ROOT, t.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify(manifest, null, 2));
  manifests.set(t.id, manifest);
}

console.log("[tutorials] 3/4 record");
run("pnpm", ["exec", "playwright", "test", "-c", "playwright.tutorials.config.ts", "record"], { TUTORIAL_MODE: "record", TUTORIAL_ONLY: only });

console.log("[tutorials] 4/4 compose");
// The series the cards count and point "Next" through: every approved tutorial, not only this run's.
const series = TUTORIALS.filter((t) => t.status === "approved");
for (const t of chosen) {
  const { video, instructions } = await produce(path.join(OUT_ROOT, t.id), t, manifests.get(t.id) ?? null, series);
  console.log(`  ${t.id}: ${path.relative(WEB, video)} · ${path.relative(WEB, instructions)}`);
}
