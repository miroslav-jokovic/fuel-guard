import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { AD_FORMATS, FORMAT_SIZE, MOTION_FORMAT, MOTION_FPS, motionTimeline, type AdBrandKit, type AdClaim, type MotionTimeline } from "@silvicom/shared";
import { renderMotionLayers, type OverlayInput } from "../overlay/overlay.js";
import { joinMotion, motionFfmpegArgs, silenceFfmpegArgs, SETTLE_MS, WORDS_IN_MS, type MotionJoinInput } from "./motionJoin.js";

/**
 * The join is tested against a real ffmpeg, because what it promises is a property of the file: its codec, its
 * frame rate, which words are on which frame. CI installs ffmpeg in `test-api` (ci.yml) and a run there WITHOUT it
 * fails — a suite that skipped quietly would certify nothing. On a laptop without ffmpeg the file-reading tests
 * are skipped and say so.
 */
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const onFile = HAS_FFMPEG ? it : it.skip;

const claims: AdClaim[] = [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }];
const KIT: OverlayInput["kit"] = {
  overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#07130E" }])) as AdBrandKit["overlays"],
  phone: "(555) 010-0142",
  colors: [{ name: "primary", hex: "#0B3D2E" }, { name: "accent", hex: "#F2B01E" }, { name: "white", hex: "#FFFFFF" }],
};
const { width: W, height: H } = FORMAT_SIZE[MOTION_FORMAT];

let dir: string;
let made: { input: MotionJoinInput; timeline: MotionTimeline; blocks: Array<{ label: string; box: { x: number; y: number; width: number; height: number } }> };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ads-motion-test-"));
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: "#5A6470" } }).png().toBuffer();
  const layers = await renderMotionLayers({
    format: MOTION_FORMAT, language: "en", base, kicker: null, headline: "Earn $0.68/mile and be home weekly", subline: "Home weekly", cta: "Apply today",
    brief: { claims }, kit: KIT, logo: null, look: "field",
  });
  if (layers.kind !== "rendered") throw new Error(JSON.stringify(layers.findings));
  const t = motionTimeline(layers.words);
  if (!t.ok) throw new Error(JSON.stringify(t.findings));
  let clip = Buffer.alloc(0);
  if (HAS_FFMPEG) {
    // A stand-in for a model's clip: another size, another frame rate, a tone on its sound track, six seconds
    // where five were asked, and a picture that changes every frame.
    const file = join(dir, "model.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=720x900:rate=24:duration=6",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
    clip = readFileSync(file);
  }
  made = { input: { clip, timeline: t.timeline, under: layers.under, words: layers.words, still: layers.still }, timeline: t.timeline, blocks: layers.blocks };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const probe = (file: string, entries: string, stream?: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "json", file]).toString());
/** One frame of the file, as raw RGB. */
function frameAt(file: string, ms: number): Buffer {
  // By its number, not by a seek: a seek to the last frame's time can land past the end and return nothing.
  const n = Math.round((ms / 1000) * MOTION_FPS);
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: W * H * 3 + 1024 });
  if (raw.length !== W * H * 3) throw new Error(`frame ${n} of ${file}: ${raw.length} bytes`);
  return raw;
}
/** Mean difference per channel between two frames inside a box. */
function differs(a: Buffer, b: Buffer, box: { x: number; y: number; width: number; height: number }): number {
  let sum = 0, n = 0;
  for (let y = Math.floor(box.y); y < box.y + box.height; y += 1) for (let x = Math.floor(box.x); x < box.x + box.width; x += 1) {
    const at = (y * W + x) * 3;
    sum += Math.abs(a[at]! - b[at]!) + Math.abs(a[at + 1]! - b[at + 1]!) + Math.abs(a[at + 2]! - b[at + 2]!);
    n += 3;
  }
  return sum / n;
}
const boxOf = (label: string) => made.blocks.find((b) => b.label === label)!.box;

describe("motionFfmpegArgs — the join's graph, read without running it", () => {
  const files = { clip: "clip.mp4", under: "under.png", words: ["w0.png", "w1.png"], still: "still.png", silence: "silence.aac", out: "out.mp4" };
  const t: MotionTimeline = { clip_ms: 5000, hold_ms: 2000, duration_ms: 7000, cues: [{ labels: ["headline"], from_ms: 0 }, { labels: ["subline"], from_ms: 1700 }] };
  const args = motionFfmpegArgs(t, files);
  const graph = args[args.indexOf("-filter_complex") + 1]!;
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("asks for what Meta's page asks: H.264 in yuv420p at a fixed rate, stereo AAC at 128k, the index in front, no edit list, no B-frames", () => {
    expect([after("-c:v"), after("-pix_fmt"), after("-r")]).toEqual(["libx264", "yuv420p", String(MOTION_FPS)]);
    const quiet = silenceFfmpegArgs(7000, "silence.aac");
    const of = (flag: string) => quiet[quiet.indexOf(flag) + 1];
    expect([of("-c:a"), of("-b:a"), of("-ac"), of("-ar"), quiet[quiet.lastIndexOf("-f") + 1]]).toEqual(["aac", "128k", "2", "48000", "adts"]);
    expect([after("-movflags"), after("-use_editlist"), after("-bf")]).toEqual(["+faststart", "0", "0"]);
  });

  it("the sound is our silence, mapped by name: the clip's own audio is never mapped (Q-APX15)", () => {
    const maps = args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
    expect(maps).toEqual(["[v]", "5:a"]);
    expect(args[args.indexOf("silence.aac") - 1]).toBe("-i");
    expect(args.indexOf("silence.aac")).toBeGreaterThan(args.indexOf("still.png"));
    expect(after("-c:a")).toBe("copy");
    expect(graph).not.toContain("[0:a]");
  });

  it("the first group is laid on from the first frame with no fade; a later one fades and rises from its cue, and is not drawn before it", () => {
    expect(graph).toContain("[l0][2:v]overlay=0:0:format=auto[l1]");
    expect(graph).toContain(`[3:v]format=rgba,fade=t=in:st=1.700:d=${(WORDS_IN_MS / 1000).toFixed(3)}:alpha=1[w1]`);
    expect(graph).toMatch(/\[l1\]\[w1\]overlay=.*enable='gte\(t\\,1\.700\)'\[l2\]/);
  });

  it("the motion runs its whole length, then dissolves into the still, and the file is as long as the timeline says", () => {
    expect(graph).toContain(`xfade=transition=fade:duration=${(SETTLE_MS / 1000).toFixed(3)}:offset=5.000`);
    expect(graph).toContain("trim=duration=5.000");
    expect(after("-t")).toBe("5.400"); // the first -t: the layer under the words, the motion and the dissolve
    expect(args[args.lastIndexOf("-t") + 1]).toBe("7.000");
  });

  it("the silence is whole AAC frames and, with the frame the encoder adds, never longer than the picture", () => {
    for (const ms of [5000, 7000, 7050, 15_000]) {
      const quiet = silenceFfmpegArgs(ms, "s.aac");
      const frames = Number(quiet[quiet.indexOf("-frames:a") + 1]);
      expect(Number.isInteger(frames)).toBe(true);
      expect(((frames + 1) * 1024) / 48) .toBeLessThanOrEqual(ms);
      expect(((frames + 2) * 1024) / 48).toBeGreaterThan(ms);
    }
  });

  it("the picture is covered to the still's frame at our frame rate, whatever the model returned", () => {
    expect(graph).toContain(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${MOTION_FPS}`);
  });
});

describe("joinMotion — the file", () => {
  it("in CI ffmpeg is installed: a run without it fails here instead of skipping everything below", () => {
    if (process.env.CI === "true") expect(HAS_FFMPEG, "ffmpeg and ffprobe must be on CI's test-api runner (ci.yml)").toBe(true);
  });

  let file: string;
  let mp4: Buffer;
  onFile("joins: an MP4 of the timeline's length", async () => {
    const out = await joinMotion(made.input);
    if (out.kind !== "joined") throw new Error(`${out.refusal}: ${out.detail}`);
    expect(out).toMatchObject({ width: W, height: H, fps: MOTION_FPS, duration_ms: made.timeline.duration_ms });
    mp4 = out.mp4;
    file = join(dir, "joined.mp4");
    writeFileSync(file, mp4);
    const { format } = probe(file, "format=duration,format_name");
    expect(format.format_name).toContain("mp4");
    expect(Number(format.duration) * 1000).toBeCloseTo(made.timeline.duration_ms, 0);
  }, 120_000);

  onFile("the picture is H.264, the still's size, square pixels, progressive, 30 frames a second throughout", () => {
    const v = probe(file, "stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_aspect_ratio,field_order,has_b_frames,nb_frames", "v:0").streams[0];
    expect(v).toMatchObject({ codec_name: "h264", width: W, height: H, pix_fmt: "yuv420p", r_frame_rate: `${MOTION_FPS}/1`, avg_frame_rate: `${MOTION_FPS}/1`, has_b_frames: 0 });
    expect(["1:1", undefined]).toContain(v.sample_aspect_ratio);
    expect(["progressive", undefined]).toContain(v.field_order);
    expect(Number(v.nb_frames)).toBe((made.timeline.duration_ms / 1000) * MOTION_FPS);
  });

  onFile("every frame is shown for the same time, the first included: the sound's start does not move the picture", () => {
    const times = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]).toString().trim().split("\n").map(Number);
    expect(times[0]).toBe(0);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.0005);
    expect(gaps[0]).toBeCloseTo(1 / MOTION_FPS, 3);
  });

  onFile("the sound is one stereo AAC track, and it is silence though the clip carried a tone", () => {
    const a = probe(file, "stream=codec_name,channels,sample_rate", "a").streams;
    expect(a).toEqual([{ codec_name: "aac", channels: 2, sample_rate: "48000" }]);
    const sound = Number(probe(file, "stream=duration", "a").streams[0].duration) * 1000;
    expect(sound).toBeLessThanOrEqual(made.timeline.duration_ms);
    expect(sound).toBeGreaterThan(made.timeline.duration_ms - 50);
    const said = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"]).stderr.toString();
    expect(Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(said)![1] === "-inf" ? -100 : /max_volume: (-?[\d.]+) dB/.exec(said)![1])).toBeLessThanOrEqual(-90);
  });

  onFile("carries no edit list, and its index is in front of its frames", () => {
    expect(mp4.includes(Buffer.from("elst"))).toBe(false);
    expect(mp4.indexOf(Buffer.from("moov"))).toBeGreaterThan(0);
    expect(mp4.indexOf(Buffer.from("moov"))).toBeLessThan(mp4.indexOf(Buffer.from("mdat")));
  });

  onFile("the last frame is the still a person approved", async () => {
    const still = await sharp(made.input.still).removeAlpha().raw().toBuffer();
    const last = frameAt(file, made.timeline.duration_ms - 1000 / MOTION_FPS);
    expect(differs(last, still, { x: 0, y: 0, width: W, height: H })).toBeLessThan(2);
  });

  onFile("the picture moves under the words: a frame in the middle is not the still's picture, and two frames apart differ", () => {
    const top = { x: 0, y: 0, width: W, height: 300 };
    const a = frameAt(file, 1000), b = frameAt(file, 3000);
    expect(differs(a, b, top)).toBeGreaterThan(2);
  });

  onFile("the headline is on the first frame; the supporting line is not there before its cue and is whole after it", async () => {
    const still = await sharp(made.input.still).removeAlpha().raw().toBuffer();
    const cue = made.timeline.cues[1]!.from_ms;
    const first = frameAt(file, 0), before = frameAt(file, cue - 2 * (1000 / MOTION_FPS)), after = frameAt(file, cue + WORDS_IN_MS + 200);
    expect(differs(first, still, boxOf("headline"))).toBeLessThan(3);
    expect(differs(first, still, boxOf("eeo"))).toBeLessThan(3);
    expect(differs(before, still, boxOf("subline"))).toBeGreaterThan(8);
    expect(differs(after, still, boxOf("subline"))).toBeLessThan(3);
  });

  it("a timeline made for other words is refused before anything is run", async () => {
    const other = { ...made.timeline, cues: [{ labels: ["headline"], from_ms: 0 }] };
    expect(await joinMotion({ ...made.input, timeline: other }, { ffmpeg: "/nonexistent/ffmpeg" })).toMatchObject({ kind: "refused", refusal: "cues_do_not_match_layers" });
    const renamed = { ...made.timeline, cues: made.timeline.cues.map((c, i) => (i === 1 ? { ...c, labels: ["kicker"] } : c)) };
    expect(await joinMotion({ ...made.input, timeline: renamed }, { ffmpeg: "/nonexistent/ffmpeg" })).toMatchObject({ kind: "refused", refusal: "cues_do_not_match_layers" });
  });

  it("a hold too short for the still to arrive is refused", async () => {
    expect(await joinMotion({ ...made.input, timeline: { ...made.timeline, hold_ms: SETTLE_MS - 1 } }, { ffmpeg: "/nonexistent/ffmpeg" })).toMatchObject({ kind: "refused", refusal: "hold_shorter_than_settle" });
  });

  it("a server without ffmpeg answers ffmpeg_missing, by name, and leaves no temporary folder behind", async () => {
    const out = await joinMotion(made.input, { ffmpeg: "/nonexistent/ffmpeg" });
    expect(out).toMatchObject({ kind: "refused", refusal: "ffmpeg_missing" });
  });

  onFile("a clip ffmpeg cannot read is ffmpeg_failed with ffmpeg's own words, not a throw", async () => {
    const out = await joinMotion({ ...made.input, clip: Buffer.from("not a video") });
    expect(out).toMatchObject({ kind: "refused", refusal: "ffmpeg_failed" });
    expect(out.kind === "refused" && out.detail.length).toBeGreaterThan(0);
  }, 60_000);
});
