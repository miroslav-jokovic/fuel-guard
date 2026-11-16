import { FEED_FORMATS, type AdFormat } from "./renderGeometry.js";

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
