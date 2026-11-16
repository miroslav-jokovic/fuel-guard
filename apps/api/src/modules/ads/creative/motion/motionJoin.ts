import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMAT_SIZE, MOTION_FORMAT, MOTION_FPS, type MotionTimeline } from "@silvicom/shared";
import type { MotionWordLayer } from "../overlay/overlay.js";

/**
 * A motion ad's file, made from its parts (ADS-PLATFORM-V2-PLAN V4; Q-APX13, Q-APX14, Q-APX15, ruled 2026-11-16).
 * In: the moving picture an image-to-video model made from the ad's picture, and the still's own layers
 * (`renderMotionLayers`). Out: one MP4. The model draws no letter (D-AD9): every word in the file is a pixel our
 * renderer painted, laid over the picture here.
 *
 * ── WHAT IS ON SCREEN, SECOND BY SECOND ───────────────────────────────────────────────────────────
 * · From the first frame: the picture moving, the scrim or band, the logo, the equal-opportunity line, the
 *   phone, and the first group of words — a feed video's first frame is what is seen before it plays.
 * · Each later group arrives at its cue (`motionTimeline`), rising `WORDS_RISE_PX` and fading in over
 *   `WORDS_IN_MS`. Nothing leaves.
 * · When the motion ends its last frame is held and dissolves, over `SETTLE_MS`, into the finished still — the
 *   image a person approved and every check was made on — which is then held to the end. A model's last frame is
 *   never the picture it started from; the dissolve is what makes "the last frame is the approved ad" true
 *   whatever the model did.
 * `WORDS_IN_MS`, `WORDS_RISE_PX` and `SETTLE_MS` are OURS, chosen by eye on the fixture clip; nothing published
 * is behind them.
 *
 * ── THE FILE IS WHAT META'S PAGE ASKS FOR (feed video, Leads objective, read 2026-11-16) ──────────
 * "H.264 compression, square pixels, fixed frame rate, progressive scan and stereo AAC audio compression at
 * 128kbps+", "MP4", 4:5, and "Videos should not contain edit lists". So: libx264, yuv420p, SAR 1, a constant
 * `MOTION_FPS`, a stereo AAC track at 128 kbit/s, the index at the front, and no B-frames — with none, no frame
 * is shown out of the order it is stored in, so the file needs no edit list to say so (`motionJoin.test.ts`
 * reads the bytes for one). The size is our still's, 1080 × 1350; Meta's page recommends 1440 × 1800 and accepts
 * less, and the still's layers are painted at 1080.
 *
 * ── THE SOUND IS SILENCE, ON PURPOSE (Q-APX15) ────────────────────────────────────────────────────
 * The model's own sound is never used: whatever audio the clip carries is dropped, and the track is silence.
 * A generated voice or horn is content nobody wrote and nothing of ours checks.
 *
 * The silence is encoded FIRST, to a file of its own, and copied into the MP4. Encoded in the same run, the AAC
 * encoder's first packet starts 1,024 samples before zero; with no edit list to say so, ffmpeg moves the picture
 * instead, and the first frame stays up 21 ms longer than every other (measured 2026-11-16: 0.0547 s against
 * 0.0333 s) — not a fixed frame rate. A finished AAC file has no such start, so the picture's times are untouched.
 * The encoder is asked for 128 kbit/s as Meta's page says; silence needs almost none of it and the track is small.
 *
 * ── FFMPEG IS A PROGRAM ON THE SERVER, NOT A PACKAGE (Q-APX14) ────────────────────────────────────
 * Debian's own build, installed in `infra/image/Dockerfile`, and by `apt` in CI's `test-api` job so this is
 * tested against the same family of encoder. Where it is missing the join answers `ffmpeg_missing` — a named
 * refusal, never a throw from a spawn.
 */

export const WORDS_IN_MS = 300;
export const WORDS_RISE_PX = 24;
export const SETTLE_MS = 400;
const AUDIO_RATE = 48_000;
const TIMEOUT_MS = 120_000;

export interface MotionJoinInput {
  /** The model's clip: any size, any frame rate, with or without sound. */
  clip: Buffer;
  timeline: MotionTimeline;
  /** `renderMotionLayers`: everything but the timed words. */
  under: Buffer;
  words: readonly Pick<MotionWordLayer, "labels" | "png">[];
  /** The finished still, the last frame. */
  still: Buffer;
}

export type MotionJoinRefusal = "ffmpeg_missing" | "cues_do_not_match_layers" | "hold_shorter_than_settle" | "ffmpeg_failed" | "ffmpeg_timeout";
export type MotionJoinOutcome =
  | { kind: "joined"; mp4: Buffer; width: number; height: number; fps: number; duration_ms: number }
  | { kind: "refused"; refusal: MotionJoinRefusal; detail: string };

const s = (ms: number) => (ms / 1000).toFixed(3);

/**
 * The ffmpeg arguments for one join. Pure: file names in, arguments out, so the graph is read and tested without
 * running anything. Inputs, in order: the clip, the layer under the words, one per words layer, the still, silence.
 */
export function motionFfmpegArgs(t: MotionTimeline, files: { clip: string; under: string; words: readonly string[]; still: string; silence: string; out: string }): string[] {
  const { width, height } = FORMAT_SIZE[MOTION_FORMAT];
  const moving = t.clip_ms + SETTLE_MS, total = t.duration_ms;
  const image = (file: string, ms: number) => ["-loop", "1", "-framerate", String(MOTION_FPS), "-t", s(ms), "-i", file];
  const still = 2 + files.words.length, silence = still + 1;

  // The picture: covered to the frame as `frameStill` covers the still, at our frame rate, cut to the clip's
  // length (a model may return a little more or less than asked), its last frame held while the still arrives.
  const graph = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${MOTION_FPS},trim=duration=${s(t.clip_ms)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${s(SETTLE_MS + 1000)},trim=duration=${s(moving)},format=yuv444p[pic]`,
    `[pic][1:v]overlay=0:0:format=auto[l0]`,
  ];
  t.cues.forEach((cue, i) => {
    const from = cue.from_ms / 1000, d = WORDS_IN_MS / 1000;
    if (cue.from_ms === 0) { graph.push(`[l${i}][${2 + i}:v]overlay=0:0:format=auto[l${i + 1}]`); return; }
    // Eased out: fast at first, settling into place. Before its cue the layer is not drawn at all.
    const rise = `${WORDS_RISE_PX}*pow(1-min(1\\,max(0\\,(t-${from.toFixed(3)})/${d.toFixed(3)}))\\,3)`;
    graph.push(`[${2 + i}:v]format=rgba,fade=t=in:st=${from.toFixed(3)}:d=${d.toFixed(3)}:alpha=1[w${i}]`);
    graph.push(`[l${i}][w${i}]overlay=x=0:y='${rise}':eval=frame:format=auto:enable='gte(t\\,${from.toFixed(3)})'[l${i + 1}]`);
  });
  graph.push(`[${still}:v]scale=${width}:${height},setsar=1,fps=${MOTION_FPS},format=yuv444p[end]`);
  graph.push(`[l${t.cues.length}][end]xfade=transition=fade:duration=${s(SETTLE_MS)}:offset=${s(t.clip_ms)},format=yuv420p[v]`);

  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", files.clip,
    ...image(files.under, moving),
    ...files.words.flatMap((w) => image(w, moving)),
    ...image(files.still, t.hold_ms),
    "-i", files.silence,
    "-filter_complex", graph.join(";"),
    "-map", "[v]", "-map", `${silence}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-bf", "0", "-pix_fmt", "yuv420p",
    "-r", String(MOTION_FPS), "-g", String(MOTION_FPS * 2),
    "-c:a", "copy", "-bsf:a", "aac_adtstoasc",
    "-t", s(total), "-movflags", "+faststart", "-use_editlist", "0", "-map_metadata", "-1",
    files.out,
  ];
}

const AAC_FRAME = 1024;
/**
 * The silent track, as an AAC file: stereo, whole frames, and never longer than the picture (the encoder adds one
 * frame of its own at the start, so one fewer is asked for).
 */
export function silenceFfmpegArgs(durationMs: number, out: string): string[] {
  const frames = Math.floor(((durationMs / 1000) * AUDIO_RATE) / AAC_FRAME) - 1;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
    "-frames:a", String(frames), "-c:a", "aac", "-b:a", "128k", "-ar", String(AUDIO_RATE), "-ac", "2", "-f", "adts", out,
  ];
}

function run(bin: string, args: string[]): Promise<{ ok: true } | { ok: false; refusal: MotionJoinRefusal; detail: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve({ ok: true });
      const e = error as NodeJS.ErrnoException & { killed?: boolean };
      if (e.code === "ENOENT") return resolve({ ok: false, refusal: "ffmpeg_missing", detail: `${bin} is not installed on this server` });
      if (e.killed) return resolve({ ok: false, refusal: "ffmpeg_timeout", detail: `no file after ${TIMEOUT_MS / 1000} s` });
      // ffmpeg's own last words; they name our temporary files and nothing of a carrier's.
      resolve({ ok: false, refusal: "ffmpeg_failed", detail: String(stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 500) });
    });
  });
}

export async function joinMotion(input: MotionJoinInput, opts: { ffmpeg?: string } = {}): Promise<MotionJoinOutcome> {
  const { timeline: t } = input;
  // The timeline was computed from these layers; one made from other words would put a group on screen at another's time.
  const same = t.cues.length === input.words.length && t.cues.every((c, i) => c.labels.join() === input.words[i]!.labels.join());
  if (!same) return { kind: "refused", refusal: "cues_do_not_match_layers", detail: `${t.cues.length} cues for ${input.words.length} layers` };
  if (t.hold_ms < SETTLE_MS) return { kind: "refused", refusal: "hold_shorter_than_settle", detail: `${t.hold_ms} ms of hold, ${SETTLE_MS} needed` };

  const dir = await mkdtemp(join(tmpdir(), "ads-motion-"));
  try {
    const files = {
      clip: join(dir, "clip.mp4"), under: join(dir, "under.png"), still: join(dir, "still.png"), silence: join(dir, "silence.aac"), out: join(dir, "out.mp4"),
      words: input.words.map((_, i) => join(dir, `words-${i}.png`)),
    };
    await Promise.all([
      writeFile(files.clip, input.clip), writeFile(files.under, input.under), writeFile(files.still, input.still),
      ...input.words.map((w, i) => writeFile(files.words[i]!, w.png)),
    ]);
    const bin = opts.ffmpeg ?? "ffmpeg";
    for (const args of [silenceFfmpegArgs(t.duration_ms, files.silence), motionFfmpegArgs(t, files)]) {
      const ran = await run(bin, args);
      if (!ran.ok) return { kind: "refused", refusal: ran.refusal, detail: ran.detail };
    }
    const { width, height } = FORMAT_SIZE[MOTION_FORMAT];
    return { kind: "joined", mp4: await readFile(files.out), width, height, fps: MOTION_FPS, duration_ms: t.duration_ms };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
