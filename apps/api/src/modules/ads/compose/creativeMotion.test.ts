import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AD_FORMATS, adMotionSchema, FORMAT_SIZE, MOTION_FORMAT, MOTION_FPS, type AdBrandKit, type AdBrief, type AdClipRef, type AdPresetRecipe } from "@silvicom/shared";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { HIGGSFIELD_VIDEO_CANDIDATES } from "../creative/higgsfield/videoModels.js";
import { clipKey, prepareClip } from "../creative/motion/motionClip.js";
import { makeMotion, MOTION_DIRECTION, type MotionDeps, type MotionInput } from "./creativeMotion.js";

/**
 * A motion ad made end to end from a picture and its words, against a real ffmpeg: the files it promises are
 * read back with ffprobe. The render road is told what to answer (its own tests are `render.clip.test.ts`); the
 * layers, the timeline, the frame check and the join are the real ones. CI's `test-api` has ffmpeg; a run there
 * without it fails below.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const onFile = HAS_FFMPEG ? it : it.skip;

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const IDS = { orgId: ORG, campaignId: "camp-1", creativeId: "cr-1" };
const MODEL = "alibaba/wan-3.0/image-to-video";
const { width: W, height: H } = FORMAT_SIZE[MOTION_FORMAT];
const BASE = { sha256: "b".repeat(64), format: "png" as const };
const overlays = (plate: string | null) => Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: plate }])) as AdBrandKit["overlays"];
const KIT = { overlays: overlays("#07130E"), phone: "(555) 010-0142", logo: null, colors: [{ name: "primary", hex: "#0B3D2E" }, { name: "accent", hex: "#F2B01E" }, { name: "white", hex: "#FFFFFF" }] } as unknown as AdBrandKit;
/** No ground colour: words straight on the picture, where a bright frame can take their contrast away. */
const BARE = { ...KIT, overlays: overlays(null) } as AdBrandKit;
const BRIEF = { claims: [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }] } as unknown as AdBrief;
const RECIPE = { layout: "bottom_plate", look: "photo", overlay_slots: { headline: "hook", cta: "cta", subline: "support" } } as unknown as AdPresetRecipe;
const COPY = {
  en: { hook: "Earn $0.68/mile and be home weekly", cta: "Apply today", support: "Home weekly" },
  es: { hook: "Gana $0.68/milla y vuelve a casa cada semana", cta: "Solicita hoy", support: "En casa cada semana" },
};

let dir: string;
let picture: Buffer;
const clips = {} as Record<"steady" | "flash" | "short" | "long", { bytes: Buffer; ref: AdClipRef }>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ads-make-motion-"));
  picture = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#1C2228" } }).png().toBuffer();
  if (!HAS_FFMPEG) return;
  const make = async (name: keyof typeof clips, seconds: number, vf?: string) => {
    const file = join(dir, `${name}.mp4`);
    // Not our frame and not our rate, as a model's clip will not be.
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x1C2228:size=720x900:rate=24:duration=${seconds}`,
      ...(vf ? ["-vf", vf] : []), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
    const bytes = readFileSync(file), p = await prepareClip(bytes);
    if (p.kind !== "ready") throw new Error(JSON.stringify(p));
    clips[name] = { bytes, ref: p.ref };
  };
  await make("steady", 5);
  await make("long", 6);
  await make("short", 3);
  await make("flash", 5, "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t\\,2\\,3)'");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let asked: RenderInput[];
let stored: Map<string, Buffer>;
let answer: RenderOutcome;
const deps = (over: Partial<MotionDeps> = {}): MotionDeps => ({
  videoModel: MODEL,
  render: async (input) => { asked.push(input); return answer; },
  readAsset: async (_org, ref) => { if (ref.sha256 !== BASE.sha256) throw new Error("another asset was read"); return picture; },
  readClip: async (_org, ref) => Object.values(clips).find((c) => c.ref.sha256 === ref.sha256)!.bytes,
  storeClip: async (org, bytes) => { const p = await prepareClip(bytes); if (p.kind !== "ready") throw new Error("not a clip"); stored.set(clipKey(org, p.ref), bytes); return p.ref; },
  ...over,
});
const input = (over: Partial<MotionInput> = {}): MotionInput => ({ ids: IDS, attempt: 1, picture: 1, base: BASE, brief: BRIEF, recipe: RECIPE, kit: KIT, copy: COPY, ...over });
const storedClip = (name: keyof typeof clips): RenderOutcome => ({ kind: "stored", generationId: "g-1", assets: [], clip: clips[name].ref, replayed: false });
const probe = (bytes: Buffer) => {
  const file = join(dir, "probe.mp4");
  writeFileSync(file, bytes);
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames", "-of", "json", file]).toString()) as { streams: Array<Record<string, string | number>> };
  return out.streams;
};

beforeEach(() => { asked = []; stored = new Map(); answer = { kind: "pending", generationId: "g-1", retryAfterSeconds: null, why: "queued" }; });

describe("makeMotion — before anything is bought", () => {
  it("in CI ffmpeg is installed: a run without it fails here instead of skipping the file tests", () => {
    if (process.env.CI === "true") expect(HAS_FFMPEG, "ffmpeg and ffprobe must be on CI's test-api runner (ci.yml)").toBe(true);
  });

  it("no video model chosen: the motion ad stops by name, and no clip is asked for", async () => {
    expect(await makeMotion(deps({ videoModel: null }), input())).toEqual({ kind: "stop", reason: "motion: no video model chosen yet (Q-APX12)" });
    expect(asked).toEqual([]);
  });

  it("words the overlay refuses stop the motion ad before a clip is asked for", async () => {
    const out = await makeMotion(deps(), input({ copy: { ...COPY, es: { ...COPY.es, hook: "Gana $0.99/milla" } } }));
    expect(out).toMatchObject({ kind: "stop", reason: expect.stringMatching(/^motion render check \(4:5, es\): /) });
    expect(asked).toEqual([]);
  });

  it("the clip is asked on the render road: the still's picture, cut to the ad's frame by its layout, five seconds, no sound, our one direction", async () => {
    expect(await makeMotion(deps(), input({ picture: 2, attempt: 3 }))).toEqual({ kind: "pending", why: "motion clip: queued" });
    expect(asked).toEqual([{
      ...IDS, attempt: 3, picture: 2, model: MODEL, reference: BASE, clip: { format: MOTION_FORMAT, layout: "bottom_plate" },
      params: { prompt: MOTION_DIRECTION, duration: 5, ...HIGGSFIELD_VIDEO_CANDIDATES[MODEL]!.sound_off },
    }]);
    // The first picture is keyed as it was before pictures were counted (`pictureKeyPart`).
    await makeMotion(deps(), input());
    expect(asked[1]).not.toHaveProperty("picture");
  });

  it("a clip the render road refused, failed, or answered with no video stops the motion ad with the road's own word", async () => {
    answer = { kind: "refused", refusal: "price_unknown" };
    expect(await makeMotion(deps(), input())).toEqual({ kind: "stop", reason: "motion clip: price_unknown" });
    answer = { kind: "failed", generationId: "g", errorCode: "output_unsupported_format", replayed: true };
    expect(await makeMotion(deps(), input())).toEqual({ kind: "stop", reason: "motion clip: output_unsupported_format" });
    answer = { kind: "budget_exhausted", generationId: "g", refusal: "budget_spent", replayed: false };
    expect(await makeMotion(deps(), input())).toEqual({ kind: "stop", reason: "motion clip: budget_spent" });
    answer = { kind: "stored", generationId: "g", assets: [], replayed: true };
    expect(await makeMotion(deps(), input())).toEqual({ kind: "stop", reason: "motion clip: no video" });
  });
});

describe("makeMotion — the files", () => {
  onFile("one clip becomes one MP4 per language, each the frame, the rate and the length its own words need, stored by its bytes", async () => {
    answer = storedClip("steady");
    const out = await makeMotion(deps(), input());
    if (out.kind !== "made") throw new Error(JSON.stringify(out));
    expect(adMotionSchema.safeParse(out.motion).success).toBe(true);
    expect(out.motion).toMatchObject({ format: MOTION_FORMAT, model: MODEL, clip: clips.steady.ref, frames_checked: 11 });
    expect(out.checks).toEqual({ ok: true, frames: 11 });
    expect(out.motion.files.map((f) => f.language)).toEqual(["en", "es"]);
    expect(asked).toHaveLength(1); // one clip for both languages
    for (const f of out.motion.files) {
      expect(f).toMatchObject({ format: "mp4", width: W, height: H, has_audio: true, path: `${ORG}/${f.sha256}.mp4` });
      const streams = probe(stored.get(f.path)!);
      const video = streams.find((s) => s.codec_type === "video")!;
      expect(video).toMatchObject({ codec_name: "h264", width: W, height: H });
      expect(Number(video.nb_read_frames)).toBe(Math.round((f.duration_ms / 1000) * MOTION_FPS));
      expect(f.duration_ms).toBeGreaterThanOrEqual(7000);
    }
    // The words differ, so the files do.
    expect(out.motion.files[0]!.sha256).not.toBe(out.motion.files[1]!.sha256);
    expect(stored.size).toBe(2);
  });

  onFile("a clip a little longer than asked is used; one more than a frame short is refused, since the join would freeze it", async () => {
    answer = storedClip("long");
    expect(await makeMotion(deps(), input())).toMatchObject({ kind: "made" });
    answer = storedClip("short");
    expect(await makeMotion(deps(), input())).toEqual({ kind: "stop", reason: "motion clip: 3.0 s came back for the 5 s asked" });
    expect(stored.size).toBe(2); // the long one's two files; nothing for the short one
  });

  onFile("a frame that takes the words' contrast away stops the motion ad with the line, the ratio and the moment, and stores no file", async () => {
    answer = storedClip("flash");
    const out = await makeMotion(deps(), input({ kit: BARE }));
    expect(out).toMatchObject({
      kind: "stop", reason: expect.stringMatching(/^motion check \(en\): the words lose their contrast while the picture moves: headline 1:1 of 3:1 from 2\.0 s/),
      checks: { ok: false, language: "en", findings: expect.arrayContaining([expect.objectContaining({ label: "headline", at_ms: 2000 })]) },
    });
    expect(stored.size).toBe(0);
    // The same clip over this kit's dark ground passes: the scrim's floor keeps white words readable (V4f).
    expect(await makeMotion(deps(), input())).toMatchObject({ kind: "made" });
  });

  onFile("a server without ffmpeg stops the motion ad by name", async () => {
    answer = storedClip("steady");
    expect(await makeMotion(deps({ ffmpeg: "/nonexistent/ffmpeg" }), input())).toEqual({ kind: "stop", reason: "motion check (en): ffmpeg_missing: /nonexistent/ffmpeg is not installed on this server" });
  });
});
