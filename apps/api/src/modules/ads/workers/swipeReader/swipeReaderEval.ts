import { readFileSync } from "node:fs";
import { z } from "zod";
import { AD_HOOK_FAMILIES, AD_SCENE_FAMILIES, figuresIn, normaliseForQuote, type PictureReading } from "@silvicom/shared";
import { recordingSchema, type EvalWorker } from "../evalKit.js";
import { SWIPE_READER_PROMPT_VERSION, buildPictureRequest, describeTool } from "./swipeReader.js";

/**
 * The Swipe reader's cases (V2r). The pictures are finished ads already in the repository — the Finished-ad
 * judge's fixtures, drawn by our own overlay on fixture photos for a "Fixture Carrier" — and one of the Checker's
 * plain photographs, so every printed word is known exactly. They stand in for a competitor's ad: what is measured
 * is reading, and an ad is read the same whoever made it. `image` is a path under `workers/`.
 *
 * ── WHEN A LIVE READING AGREES ────────────────────────────────────────────────────────────────────────
 * The answer is the tool's shape (`ready`); its `hook_family` and `scene_family` are among the truth's (a list,
 * where a person could fairly read the ad two ways — each such fixture says why in `about`); every phrase of
 * `truth.words` is in what it read, compared without case or line breaks (an ad set in capitals may be copied
 * either way, and one headline may be read as two lines); and every figure it read is a figure printed on the ad
 * — a digit it invented is the misreading that matters, because a plan reads it.
 */
export const swipeReaderFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({ image: z.string().regex(/^[a-zA-Z]+\/fixtures\/images\/[a-z0-9-]+\.(jpg|png)$/), note: z.string().nullable() }),
  expect: z.enum(["ready", "off_schema"]),
  truth: z.object({
    hook_family: z.array(z.enum(AD_HOOK_FAMILIES)).min(1),
    scene_family: z.array(z.enum(AD_SCENE_FAMILIES)).min(1),
    words: z.array(z.string().min(1)),
  }),
  recorded: recordingSchema,
}).strict();
export type SwipeReaderFixture = z.infer<typeof swipeReaderFixtureSchema>;

const WORKERS = new URL("../", import.meta.url);
export const fixtureImage = (f: SwipeReaderFixture) => {
  const bytes = readFileSync(new URL(f.input.image, WORKERS));
  return { format: f.input.image.endsWith(".png") ? "png" as const : "jpeg" as const, bytes: new Uint8Array(bytes) };
};

const flat = (s: string) => normaliseForQuote(s).toLowerCase();

export function swipeReaderFindings(f: SwipeReaderFixture, r: PictureReading): string[] {
  const out: string[] = [];
  if (!f.truth.hook_family.includes(r.hook_family)) out.push(`hook:${r.hook_family}`);
  if (!f.truth.scene_family.includes(r.scene_family)) out.push(`scene:${r.scene_family}`);
  const read = flat(r.words.join(" "));
  for (const w of f.truth.words) if (!read.includes(flat(w))) out.push(`missing:${w}`);
  const printed = new Set(f.truth.words.flatMap(figuresIn).map((x) => String(Number(x))));
  for (const x of [...r.words, r.summary].flatMap(figuresIn)) if (!printed.has(String(Number(x)))) out.push(`invented:${x}`);
  return [...new Set(out)];
}

export const SWIPE_READER_EVAL: EvalWorker<SwipeReaderFixture, PictureReading> = {
  promptVersion: SWIPE_READER_PROMPT_VERSION,
  dir: new URL("./fixtures/", import.meta.url),
  parse: (raw) => swipeReaderFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildPictureRequest(fixtureImage(f), f.input.note),
  judge: (f, output) => {
    const parsed = describeTool.schema.safeParse(output);
    return parsed.success ? { verdict: "ready", findings: swipeReaderFindings(f, parsed.data) } : { verdict: "off_schema", findings: [] };
  },
  agrees: (f, verdict, findings) => verdict === f.expect && (verdict !== "ready" || findings.length === 0),
  withRecording: (f, recorded) => ({ ...f, recorded }),
};
