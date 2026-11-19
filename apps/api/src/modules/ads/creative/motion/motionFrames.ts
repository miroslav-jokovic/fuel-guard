import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRender, MOTION_FORMAT, MOTION_FPS, MOTION_MIN_CUE_MS, MOTION_SIZE, type MotionTimeline, type PlacedText, type Rect, type Rgb } from "@silvicom/shared";
import { motionPictureChain, runFfmpeg, SETTLE_MS, WORDS_IN_MS, type FfmpegRefusal } from "./motionJoin.js";

/**
 * The contrast check of a motion ad's frames BEFORE the last (ADS-PLATFORM-V2-PLAN V4 "Checks"; V4f).
 *
 * ── WHY THE STILL'S VERDICT IS NOT ENOUGH ─────────────────────────────────────────────────────────
 * The still's contrast was measured under every line on the finished picture, and the scrim was chosen for THAT
 * picture. A motion ad ends on that frame (the dissolve makes it so), but for five seconds before it the picture
 * under the words is whatever the model drew: a truck's white cab can roll under a headline that was approved on
 * dark road. `field` and `number` put their words on a solid band, which does not move; `photo` puts them on the
 * picture. Nothing here asks which look it is — every row is sampled, and a row on a band simply never fails.
 *
 * ── WHAT IS SAMPLED IS THE BACKGROUND, NOT THE FILE ───────────────────────────────────────────────
 * The joined file has the words in it, and a line's own ink is not its background: read under a line's box, it
 * would always answer about 1:1. So the frames judged are the moving picture with `ground` over it — our scrim,
 * band and logo, no word (`renderMotionLayers`) — built by the SAME filter chain the join shows the picture with
 * (`motionPictureChain`), before the encoder. The still's check works the same way: it samples, then paints.
 *
 * ── ONE JUDGEMENT ─────────────────────────────────────────────────────────────────────────────────
 * The pixels go to `checkRender` (shared), under the same line boxes at the same sample step as the still, so a
 * line is held to one rule on every frame: its WORST sampled pixel must reach the ratio its size requires. Only
 * `low_contrast` is taken from the verdict; where a line sits was judged on the still and has not changed.
 *
 * ── WHICH FRAMES, AND WHICH LINES ON EACH ─────────────────────────────────────────────────────────
 * · Every `FRAME_CHECK_EVERY_MS` from the first frame, plus the motion's last frame, which is held under the
 *   dissolve. Half the shortest time a group of words is given to be read (`MOTION_MIN_CUE_MS`), so every reading
 *   window is looked at twice or more. The figure is OURS: something bright that crosses a line between two
 *   samples is not seen. Every frame would see it, at 150 frames of 7.8 MB each; nothing published says how many
 *   are enough, and a real clip has not been looked at yet (Q-APX12).
 * · A line is judged from the moment it has arrived: its cue, plus `WORDS_IN_MS` when it fades in. Before that it
 *   is not on screen, and while it fades and rises it is neither where nor as strong as it will be.
 * · A failing frame refuses the MOTION ad. The still passed its own check and is untouched.
 *
 * ── WHEN IT CAN FAIL AT ALL (measured 2026-11-17) ─────────────────────────────────────────────────
 * With a dark ground colour and white words, the weakest scrim step (45 %) already leaves white at about 3.3:1
 * over a frame that is white edge to edge, and every row of today's looks is large text (3:1). So for such a kit
 * no picture fails this check: the scrim's floor is the protection. It decides for a kit that asks for no scrim
 * (`plate_color` null), one with a lighter ground, or words that are not white — and for any row a later look
 * draws below 24 px. `motionFrames.test.ts` holds the measurement.
 */

export const FRAME_CHECK_EVERY_MS = MOTION_MIN_CUE_MS / 2;
/** The still's own sample step (`overlay.ts` `SAMPLE_STEP`): every fourth pixel in each direction. */
const SAMPLE_STEP = 4;

export interface MotionFrameFinding { kind: "low_contrast_in_motion"; label: string; /** The first sampled frame that fails. */ at_ms: number; /** The lowest ratio on any sampled frame. */ worst: number; required: number; frames: number }

export interface MotionFramesInput {
  /** The model's clip, as given to the join. */
  clip: Buffer;
  timeline: MotionTimeline;
  /** `renderMotionLayers`' `ground`, `blocks` and `lines` (the lines in the motion frame's pixels). */
  ground: Buffer;
  blocks: readonly PlacedText[];
  lines: Readonly<Record<string, Rect[]>>;
}

export type MotionFramesOutcome =
  | { kind: "checked"; frames: number; findings: MotionFrameFinding[] }
  | { kind: "refused"; refusal: FfmpegRefusal; detail: string };

/** The frame numbers judged: one every `FRAME_CHECK_EVERY_MS` of the motion, and its last frame. Pure. */
export function motionSampleFrames(t: Pick<MotionTimeline, "clip_ms">): number[] {
  const last = Math.round((t.clip_ms / 1000) * MOTION_FPS) - 1, every = Math.round((FRAME_CHECK_EVERY_MS / 1000) * MOTION_FPS);
  const out: number[] = [];
  for (let n = 0; n < last; n += every) out.push(n);
  return [...out, last];
}

/** A two-coloured row is two blocks (`headline`, `headline_figures`) over the same lines. */
const rowOf = (label: string) => label.replace(/_figures$/, "");

/** When a row has arrived, in ms; 0 for the rows on every frame and for the first group. Pure. */
export function arrivesAt(t: Pick<MotionTimeline, "cues">, label: string): number {
  const cue = t.cues.find((c) => c.labels.includes(rowOf(label)));
  return !cue || cue.from_ms === 0 ? 0 : cue.from_ms + WORDS_IN_MS;
}

/** The ffmpeg arguments: the picture as the join shows it, `ground` over it, the chosen frames out as raw RGB. Pure. */
export function frameCheckFfmpegArgs(t: MotionTimeline, frames: readonly number[], files: { clip: string; ground: string; out: string }): string[] {
  const pick = frames.map((n) => `eq(n\\,${n})`).join("+");
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", files.clip,
    "-loop", "1", "-framerate", String(MOTION_FPS), "-t", ((t.clip_ms + SETTLE_MS) / 1000).toFixed(3), "-i", files.ground,
    "-filter_complex", `[0:v]${motionPictureChain(t)}[pic];[pic][1:v]overlay=0:0:format=auto,select='${pick}',setpts=N/FRAME_RATE/TB[v]`,
    // The picked frames are given consecutive times, so the fixed-rate writer neither repeats one to fill the gap
    // nor needs a sync flag whose name changed between ffmpeg 5 and 7.
    "-map", "[v]", "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", files.out,
  ];
}

function samplesUnder(frame: Buffer, width: number, height: number, box: Rect): Rgb[] {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(width - x, Math.floor(box.width))), h = Math.max(1, Math.min(height - y, Math.floor(box.height)));
  const out: Rgb[] = [];
  for (let j = 0; j < h; j += SAMPLE_STEP) for (let i = 0; i < w; i += SAMPLE_STEP) {
    const at = ((y + j) * width + x + i) * 3;
    out.push([frame[at]!, frame[at + 1]!, frame[at + 2]!]);
  }
  return out;
}

/** One frame's verdict: every block that has arrived, judged on what lies under its lines on this frame. */
export function judgeMotionFrame(frame: Buffer, atMs: number, input: Pick<MotionFramesInput, "timeline" | "blocks" | "lines">): Array<{ label: string; worst: number; required: number }> {
  const { width, height } = MOTION_SIZE;
  const placed = input.blocks.filter((b) => arrivesAt(input.timeline, b.label) <= atMs).map((b) => {
    // The lines are in the frame's pixels; the block's own box is on the still's frame. Falling back to it would read
    // the wrong place on a 1440 frame and pass a line nobody looked under — so a row with no lines is our bug, said.
    const lines = input.lines[rowOf(b.label)];
    if (!lines?.length) throw new Error(`motion frame check: no line boxes for ${b.label}`);
    return { ...b, background_samples: lines.flatMap((box) => samplesUnder(frame, width, height, box)) };
  });
  // The blocks' boxes and sizes are the still's frame's, so its own safe zone is the one they are held to; only the
  // contrast verdict is taken here, read off this frame's pixels.
  return checkRender(MOTION_FORMAT, placed).flatMap((f) => (f.kind === "low_contrast" ? [{ label: f.label, worst: f.worst, required: f.required }] : []));
}

export async function checkMotionFrames(input: MotionFramesInput, opts: { ffmpeg?: string } = {}): Promise<MotionFramesOutcome> {
  const { width, height } = MOTION_SIZE, size = width * height * 3;
  const frames = motionSampleFrames(input.timeline);
  const dir = await mkdtemp(join(tmpdir(), "ads-motion-frames-"));
  try {
    const files = { clip: join(dir, "clip.mp4"), ground: join(dir, "ground.png"), out: join(dir, "frames.rgb") };
    await Promise.all([writeFile(files.clip, input.clip), writeFile(files.ground, input.ground)]);
    const ran = await runFfmpeg(opts.ffmpeg ?? "ffmpeg", frameCheckFfmpegArgs(input.timeline, frames, files));
    if (!ran.ok) return { kind: "refused", refusal: ran.refusal, detail: ran.detail };

    // One frame in memory at a time: a frame is 7.8 MB at 1440 × 1800 and there are a dozen.
    const file = await open(files.out, "r");
    const byLabel = new Map<string, MotionFrameFinding>();
    try {
      const { size: bytes } = await file.stat();
      // The picture chain holds a short clip's last frame, so every picked frame should exist. If one does not,
      // judging the ones that do would pass a motion ad on frames nobody looked at.
      if (bytes !== frames.length * size) return { kind: "refused", refusal: "ffmpeg_failed", detail: `${bytes / size} frames came back for the ${frames.length} asked` };
      const frame = Buffer.alloc(size);
      for (const [i, n] of frames.entries()) {
        await file.read(frame, 0, size, i * size);
        const atMs = Math.round((n / MOTION_FPS) * 1000);
        for (const f of judgeMotionFrame(frame, atMs, input)) {
          const prior = byLabel.get(f.label);
          byLabel.set(f.label, prior
            ? { ...prior, worst: Math.min(prior.worst, f.worst), frames: prior.frames + 1 }
            : { kind: "low_contrast_in_motion", label: f.label, at_ms: atMs, worst: f.worst, required: f.required, frames: 1 });
        }
      }
    } finally {
      await file.close();
    }
    return { kind: "checked", frames: frames.length, findings: [...byLabel.values()] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
