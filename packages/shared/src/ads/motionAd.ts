import { z } from "zod";
import { AD_FORMATS, FEED_FORMATS, type AdFormat } from "./renderGeometry.js";

/**
 * When each line of a motion ad appears (ADS-PLATFORM-V2-PLAN V4, Q-APX13). Pure: no image, no clock, no ffmpeg.
 *
 * ── WHAT A MOTION AD IS ───────────────────────────────────────────────────────────────────────────
 * The picture of a finished still, set moving for a few seconds by an image-to-video model, with the SAME words
 * the still carries drawn over it by our own renderer (D-AD9: no model draws a letter). The words arrive one
 * group after another and none leaves, so the last frame is the still a person approved — the frame whose
 * contrast, safe zone and claims were already checked. That frame is then held.
 *
 * ── WHERE EACH NUMBER COMES FROM ──────────────────────────────────────────────────────────────────
 * · 20 characters a second: Netflix's Timed Text Style Guide, "up to 20 characters per second for adult
 *   programs" (read 2026-11-16) — the one published reading speed we found for words over moving pictures.
 * · 15 seconds: the plan's own limit for a video ad (V4 "Checks").
 * · 5 seconds of motion: the default clip length of both image-to-video models whose pages were read
 *   (Seedance 2.0, Wan 3.0), and inside every listed model's range.
 * · 30 frames a second: Meta asks for a "fixed frame rate" and names none; 30 is OUR choice.
 * · One second at least per group, and two seconds of the finished ad held at the end: OURS, with nothing
 *   published behind them — Q-APX13 asks the owner to look at a real clip before they are believed.
 */
export const CAPTION_CHARS_PER_SECOND = 20;
export const MOTION_MAX_MS = 15_000;
export const MOTION_CLIP_MS = 5_000;
export const MOTION_FPS = 30;
export const MOTION_MIN_CUE_MS = 1_000;
export const MOTION_HOLD_MS = 2_000;

/**
 * The one frame a motion ad is made in: the feed's first format, which is also the ratio Meta's own page
 * recommends for a feed video with the Leads objective ("Ratio: 4:5", read 2026-11-16). Derived, so the day the
 * feed's first format moves, the video moves with it.
 */
export const MOTION_FORMAT: AdFormat = FEED_FORMATS[0]!;

/** Words that arrive together: the overlay rows drawn at one moment (`labels`) and how many characters they are. */
export interface MotionGroup { labels: string[]; chars: number }

export interface MotionCue { labels: string[]; /** When the group appears; it stays to the end. */ from_ms: number }

export interface MotionTimeline {
  /** The moving picture's length; the model is asked for exactly this. */
  clip_ms: number;
  /** How long the last frame — the finished ad — is held after the motion ends. */
  hold_ms: number;
  duration_ms: number;
  cues: MotionCue[];
}

export type MotionFinding =
  | { kind: "no_words" }
  | { kind: "empty_group"; index: number }
  | { kind: "too_long"; duration_ms: number; max_ms: number };

const FRAME_MS = 1000 / MOTION_FPS;
/** Up to the next whole frame: a cue between two frames would be drawn on the later one anyway. */
const toFrame = (ms: number) => Math.max(0, Math.round(Math.ceil(ms / FRAME_MS - 1e-9) * FRAME_MS));

/** How long a group needs on screen before the next may arrive. */
export function readMs(chars: number): number {
  return Math.max(MOTION_MIN_CUE_MS, Math.ceil((chars / CAPTION_CHARS_PER_SECOND) * 1000));
}

/**
 * The timeline of one motion ad. The first group is on screen from the first frame (a feed video starts muted
 * and unasked; a frame with no words says nothing). Each later group arrives when the one before it has had its
 * reading time. When the last group's reading time runs past the clip, the hold grows to cover it, so nothing is
 * ever on screen for less than it takes to read — and an ad whose words need more than the limit is refused
 * rather than sped up.
 */
export function motionTimeline(groups: readonly MotionGroup[], clipMs: number = MOTION_CLIP_MS): { ok: true; timeline: MotionTimeline } | { ok: false; findings: MotionFinding[] } {
  if (groups.length === 0) return { ok: false, findings: [{ kind: "no_words" }] };
  const empty = groups.flatMap((g, index) => (g.labels.length === 0 || g.chars <= 0 ? [{ kind: "empty_group" as const, index }] : []));
  if (empty.length) return { ok: false, findings: empty };

  const cues: MotionCue[] = [];
  let at = 0;
  for (const g of groups) {
    cues.push({ labels: [...g.labels], from_ms: toFrame(at) });
    at = toFrame(at) + readMs(g.chars);
  }
  // `at` is now the moment the last group has been read.
  const hold = toFrame(Math.max(MOTION_HOLD_MS, at - clipMs + MOTION_HOLD_MS));
  const duration = clipMs + hold;
  if (duration > MOTION_MAX_MS) return { ok: false, findings: [{ kind: "too_long", duration_ms: duration, max_ms: MOTION_MAX_MS }] };
  return { ok: true, timeline: { clip_ms: clipMs, hold_ms: hold, duration_ms: duration, cues } };
}

/**
 * A moving picture in our storage: a model's clip (V4e), named by its bytes as every ad asset is. NOT an
 * `AdAssetRef` on purpose: that type is "an image the renderer can draw", read by the kit, the overlay and the
 * publisher's image upload, and a video among them would be a file each of those must learn to refuse. What is
 * recorded is what was READ OFF THE FILE when it was copied — the frame and length the model actually returned,
 * and whether it carries a sound track although every model is told to make none (Q-APX15). None of the three
 * candidates' pages states what frame comes back; this record is where the sitting (Q-APX12) reads it.
 */
export const adClipRefSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.literal("mp4"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
  has_audio: z.boolean(),
  byte_size: z.number().int().positive(),
});
export type AdClipRef = z.infer<typeof adClipRefSchema>;

/**
 * A creative's motion ad, as `ads_creatives.motion` holds it (migration 0625; V4h). One model's clip, joined once
 * per language with that language's words. The still is not here: it stays in `assets`, where it always was, and
 * is the last frame of every file below.
 */
export const adMotionSchema = z.object({
  format: z.enum(AD_FORMATS),
  /** The image-to-video model that made the clip. */
  model: z.string().min(1).max(200),
  clip: adClipRefSchema,
  files: z.array(adClipRefSchema.extend({ language: z.enum(["en", "es"]), path: z.string().min(1).max(300) })).min(1).max(2),
  /** How many frames of the moving picture the contrast check looked at, per language. */
  frames_checked: z.number().int().positive(),
});
export type AdMotion = z.infer<typeof adMotionSchema>;

/** A motion ad as the review screen reads it: each language's file with a short-lived link (null when none could be made). */
export type AdMotionView = Omit<AdMotion, "files"> & { files: Array<AdMotion["files"][number] & { url: string | null }> };

/**
 * What the review screen says about an ad's video (V4): null for an ad that was never asked to move — every ad
 * before V4, and every still angle — so the screen shows nothing; otherwise whether one was made, and why not.
 * Read from `checks.motion`, which compose writes only when the plan's angle asked for a motion ad
 * (`composeCreative` `motionOf`): `{ ok: true, frames }` when the video was made, else `{ ok: false, reason }`
 * with compose's own sentence. A body this cannot read says so; it is never read as "made".
 */
export type MotionOpinion = { made: true; frames: number } | { made: false; why: string };
const motionCheckSchema = z.object({ ok: z.boolean(), frames: z.number().int().positive().optional(), reason: z.string().min(1).optional() }).passthrough();
export function motionOpinion(raw: unknown): MotionOpinion | null {
  if (raw === undefined || raw === null) return null;
  const parsed = motionCheckSchema.safeParse(raw);
  if (!parsed.success) return { made: false, why: "the record of it could not be read" };
  const c = parsed.data;
  if (c.ok && c.frames !== undefined) return { made: true, frames: c.frames };
  // Compose's sentence opens with "motion" ("motion clip: …", "motion: …"); the screen's own sentence already says it is about the video.
  return { made: false, why: (c.reason ?? "no reason was recorded").replace(/^motion:? /, "") };
}
