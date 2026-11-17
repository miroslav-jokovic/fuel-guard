import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { AD_FORMATS, FORMAT_SIZE, MOTION_FORMAT, MOTION_FPS, MOTION_MIN_CUE_MS, motionTimeline, type AdBrandKit, type AdClaim, type AdLook, type MotionTimeline, type Rect } from "@silvicom/shared";
import { renderMotionLayers, type OverlayInput } from "../overlay/overlay.js";
import { arrivesAt, checkMotionFrames, FRAME_CHECK_EVERY_MS, frameCheckFfmpegArgs, judgeMotionFrame, motionSampleFrames, type MotionFramesInput } from "./motionFrames.js";
import { motionFfmpegArgs, motionPictureChain, WORDS_IN_MS } from "./motionJoin.js";

/**
 * The frame check reads frames ffmpeg made, so it is tested against a real ffmpeg, as the join is; CI's `test-api`
 * installs it and a run there without it fails (below). The "model's clip" is a flat dark picture, on which the
 * still passes, with a white box switched on over one line for a stretch of time — the white cab that rolls
 * under a headline approved on dark road.
 */
// Each file test encodes five seconds of 1080 × 1350 video and reads eleven raw frames back. On a loaded machine
// that passed the default five seconds (measured 2026-11-17 at a load average of 25: 5.0 to 5.6 s) and the tests
// failed as timeouts, not as wrong answers.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const onFile = HAS_FFMPEG ? it : it.skip;

const claims: AdClaim[] = [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }];
const KIT: OverlayInput["kit"] = {
  overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#07130E" }])) as AdBrandKit["overlays"],
  phone: "(555) 010-0142",
  colors: [{ name: "primary", hex: "#0B3D2E" }, { name: "accent", hex: "#F2B01E" }, { name: "white", hex: "#FFFFFF" }],
};
/**
 * The same kit with no ground colour: "words straight on the picture, nothing darkened, the check alone decides"
 * (`overlay.ts`). This is the kit the frame check exists for — see the measurement in the last test.
 */
const BARE: OverlayInput["kit"] = { ...KIT, overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: null }])) as AdBrandKit["overlays"] };
const { width: W, height: H } = FORMAT_SIZE[MOTION_FORMAT];
const DARK = "0x1C2228";

type Made = { input: Omit<MotionFramesInput, "clip">; timeline: MotionTimeline; lines: Record<string, Rect[]>; on: Record<string, boolean> };
let dir: string;
const made = {} as Record<"photo" | "field" | "scrimmed", Made>;

async function layersOf(look: AdLook, kit: OverlayInput["kit"]): Promise<Made & { scrim: number }> {
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: `#${DARK.slice(2)}` } }).png().toBuffer();
  const layers = await renderMotionLayers({
    format: MOTION_FORMAT, language: "en", base, kicker: null, headline: "Earn $0.68/mile and be home weekly", subline: "Home weekly", cta: "Apply today",
    brief: { claims }, kit, logo: null, look,
  });
  if (layers.kind !== "rendered") throw new Error(JSON.stringify(layers.findings));
  const t = motionTimeline(layers.words);
  if (!t.ok) throw new Error(JSON.stringify(t.findings));
  // A row is on the picture when nothing of ours is painted behind it: `ground` is transparent under its first line.
  const { data, info } = await sharp(layers.ground).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const on = Object.fromEntries(Object.entries(layers.lines).map(([label, boxes]) => {
    const b = boxes[0]!;
    return [label, data[(Math.floor(b.y + b.height / 2) * info.width + Math.floor(b.x + b.width / 2)) * 4 + 3]! < 250];
  }));
  return { input: { timeline: t.timeline, ground: layers.ground, blocks: layers.blocks, lines: layers.lines }, timeline: t.timeline, lines: layers.lines, on, scrim: layers.scrim };
}

/** A five-second dark clip with white boxes over `boxes` while `between` holds (seconds). */
function clipWith(name: string, flashes: Array<{ boxes: Rect[]; from: number; to: number }>, seconds = 5): Buffer {
  const file = join(dir, `${name}.mp4`);
  const draw = flashes.flatMap((f) => f.boxes.map((b) => `drawbox=x=${Math.floor(b.x) - 8}:y=${Math.floor(b.y) - 8}:w=${Math.ceil(b.width) + 16}:h=${Math.ceil(b.height) + 16}:color=white:t=fill:enable='between(t\\,${f.from}\\,${f.to})'`));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${DARK}:size=${W}x${H}:rate=${MOTION_FPS}:duration=${seconds}`,
    ...(draw.length ? ["-vf", draw.join(",")] : []), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
  return readFileSync(file);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ads-motion-frames-test-"));
  made.photo = await layersOf("photo", BARE);
  made.field = await layersOf("field", KIT);
  made.scrimmed = await layersOf("photo", KIT);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("which frames are judged, and which lines on each", () => {
  it("one frame every half of the shortest reading time, from the first, and the motion's last frame", () => {
    expect(FRAME_CHECK_EVERY_MS).toBe(MOTION_MIN_CUE_MS / 2);
    expect(motionSampleFrames({ clip_ms: 5000 })).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 149]);
    expect(motionSampleFrames({ clip_ms: 4000 })).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 119]);
  });

  it("a line is judged once it has arrived: at once for the first group and the always-on rows, after its fade for a later one", () => {
    const t = { cues: [{ labels: ["headline_figure", "headline"], from_ms: 0 }, { labels: ["subline"], from_ms: 1700 }] };
    expect(arrivesAt(t, "headline")).toBe(0);
    expect(arrivesAt(t, "headline_figures")).toBe(0); // the second colour of a two-coloured row is that row
    expect(arrivesAt(t, "subline")).toBe(1700 + WORDS_IN_MS);
    // A later row drawn in two colours: its figures arrive with it, not on the first frame.
    expect(arrivesAt(t, "subline_figures")).toBe(1700 + WORDS_IN_MS);
    expect(arrivesAt(t, "eeo")).toBe(0);
    expect(arrivesAt(t, "phone")).toBe(0);
  });

  it("the frames are made by the join's own picture chain, with the ground over it and no word", () => {
    const t = made.photo.timeline;
    const args = frameCheckFfmpegArgs(t, [0, 15, 149], { clip: "clip.mp4", ground: "ground.png", out: "frames.rgb" });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    const joined = motionFfmpegArgs(t, { clip: "c", under: "u", words: t.cues.map((_, i) => `w${i}`), still: "s", silence: "a", out: "o" });
    expect(graph).toContain(`[0:v]${motionPictureChain(t)}[pic]`);
    expect(joined[joined.indexOf("-filter_complex") + 1]).toContain(`[0:v]${motionPictureChain(t)}[pic]`);
    expect(graph).toContain("select='eq(n\\,0)+eq(n\\,15)+eq(n\\,149)'");
    expect(args.filter((a) => a.endsWith(".png"))).toEqual(["ground.png"]);
    expect(args.slice(-5)).toEqual(["-f", "rawvideo", "-pix_fmt", "rgb24", "frames.rgb"]);
  });
});

describe("checkMotionFrames — the frames before the last", () => {
  it("in CI ffmpeg is installed: a run without it fails here instead of skipping everything below", () => {
    if (process.env.CI === "true") expect(HAS_FFMPEG, "ffmpeg and ffprobe must be on CI's test-api runner (ci.yml)").toBe(true);
  });

  it("the fixture is what the tests below assume: `photo` has its headline on the picture, `field` on its band", () => {
    expect(made.photo.on.headline).toBe(true);
    expect(made.field.on.headline).toBe(false);
    expect(made.photo.timeline.cues.map((c) => c.labels)).toEqual([["headline"], ["subline"]]);
    expect(arrivesAt(made.photo.timeline, "subline")).toBe(2000);
  });

  onFile("a picture that stays as dark as the still passes, on every frame picked", async () => {
    const out = await checkMotionFrames({ ...made.photo.input, clip: clipWith("steady", []) });
    expect(out).toEqual({ kind: "checked", frames: 11, findings: [] });
  });

  onFile("something bright under the headline for half a second refuses the motion ad, naming the line, the moment and the ratio", async () => {
    const out = await checkMotionFrames({ ...made.photo.input, clip: clipWith("flash", [{ boxes: made.photo.lines.headline!, from: 2.2, to: 2.8 }]) });
    if (out.kind !== "checked") throw new Error(out.detail);
    expect(out.findings).toEqual([{ kind: "low_contrast_in_motion", label: "headline", at_ms: 2500, worst: expect.any(Number), required: 3, frames: 1 }]);
    expect(out.findings[0]!.worst).toBeLessThan(3);
  });

  onFile("the same brightness that lasts is counted on every frame it is seen on, and reported once", async () => {
    const out = await checkMotionFrames({ ...made.photo.input, clip: clipWith("long", [{ boxes: made.photo.lines.headline!, from: 0.9, to: 3.1 }]) });
    if (out.kind !== "checked") throw new Error(out.detail);
    expect(out.findings).toMatchObject([{ label: "headline", at_ms: 1000, frames: 5 }]);
  });

  onFile("brightness where a later line WILL be is no finding before the line has arrived, and is one after", async () => {
    const boxes = made.photo.lines.subline!;
    const before = await checkMotionFrames({ ...made.photo.input, clip: clipWith("before", [{ boxes, from: 0, to: 1.8 }]) });
    expect(before).toMatchObject({ kind: "checked", findings: [] });
    const after = await checkMotionFrames({ ...made.photo.input, clip: clipWith("after", [{ boxes, from: 2.9, to: 3.1 }]) });
    expect(after).toMatchObject({ kind: "checked", findings: [{ label: "subline", at_ms: 3000, frames: 1 }] });
  });

  it("only what lies under a line counts, as on the still: brightness in the gap between two headline lines is no finding", () => {
    // Straight on a frame's pixels, no clip: the gap between this headline's lines is 13 px, too narrow to hit
    // through an encoder without touching a line.
    const [first, second] = made.photo.lines.headline!;
    const from = Math.ceil(first!.y + first!.height) + 2, to = Math.floor(second!.y) - 2;
    expect(to - from).toBeGreaterThanOrEqual(8); // at least two sampled rows (every fourth) fall inside
    const frame = Buffer.alloc(W * H * 3, 0x20);
    frame.fill(0xff, from * W * 3, to * W * 3);
    expect(judgeMotionFrame(frame, 4000, made.photo.input)).toEqual([]);
    // The same white one row lower reaches the second line, and is a finding.
    frame.fill(0xff, from * W * 3, (Math.floor(second!.y) + 8) * W * 3);
    expect(judgeMotionFrame(frame, 4000, made.photo.input)).toMatchObject([{ label: "headline", required: 3 }]);
  });

  onFile("the motion's last frame is judged: it is the one held under the dissolve", async () => {
    const out = await checkMotionFrames({ ...made.photo.input, clip: clipWith("last", [{ boxes: made.photo.lines.headline!, from: 4.95, to: 5 }]) });
    expect(out).toMatchObject({ kind: "checked", findings: [{ label: "headline", at_ms: 4967, frames: 1 }] });
  });

  onFile("words on a band do not care what the picture does: `field` passes a frame that goes white edge to edge", async () => {
    const whole = [{ x: 8, y: 8, width: W - 16, height: H - 16 }];
    const out = await checkMotionFrames({ ...made.field.input, clip: clipWith("white", [{ boxes: whole, from: 1, to: 4 }]) });
    if (out.kind !== "checked") throw new Error(out.detail);
    const onBand = Object.entries(made.field.on).filter(([, picture]) => !picture).map(([label]) => label);
    expect(onBand).toContain("headline");
    expect(out.findings.filter((f) => onBand.includes(f.label.replace(/_figures$/, "")))).toEqual([]);
    // The same white frame under `photo`, whose words are on the picture, is refused.
    const photo = await checkMotionFrames({ ...made.photo.input, clip: clipWith("white-photo", [{ boxes: whole, from: 1, to: 4 }]) });
    expect(photo).toMatchObject({ kind: "checked", findings: expect.arrayContaining([expect.objectContaining({ label: "headline" })]) });
  });

  onFile("a clip shorter than was asked is judged as it is shown: its last frame held, on every frame picked", async () => {
    // The join's picture chain holds a clip's last frame, so a short clip freezes; it does not end. What was on
    // that frame is therefore on every later one, and is seen on each.
    const out = await checkMotionFrames({ ...made.photo.input, clip: clipWith("short", [{ boxes: made.photo.lines.headline!, from: 2.95, to: 3 }], 3) });
    expect(out).toMatchObject({ kind: "checked", frames: 11, findings: [{ label: "headline", at_ms: 3000, frames: 5 }] });
  });

  onFile("MEASURED 2026-11-17: this kit's dark ground at the weakest scrim step keeps white words at 3:1 over a frame that is white edge to edge", async () => {
    // Why the tests above use a kit with no ground colour. Every row of this ad is large text (3:1), and 45 % of
    // #07130E over pure white is a grey white still reads on at about 3.3:1 — so with THIS kit no picture can fail
    // the frame check. It bites for a kit that asks for no scrim, a lighter ground, or a text colour that is not white.
    expect((made.scrimmed as Made & { scrim: number }).scrim).toBe(0.45);
    const whole = [{ x: 8, y: 8, width: W - 16, height: H - 16 }];
    expect(await checkMotionFrames({ ...made.scrimmed.input, clip: clipWith("white-scrimmed", [{ boxes: whole, from: 0, to: 5 }]) })).toEqual({ kind: "checked", frames: 11, findings: [] });
  });

  it("a server without ffmpeg answers `ffmpeg_missing`, as the join does", async () => {
    const out = await checkMotionFrames({ ...made.photo.input, clip: Buffer.from("x") }, { ffmpeg: "/nonexistent/ffmpeg" });
    expect(out).toEqual({ kind: "refused", refusal: "ffmpeg_missing", detail: "/nonexistent/ffmpeg is not installed on this server" });
  });
});
