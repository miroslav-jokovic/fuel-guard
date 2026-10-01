/**
 * The in-page scanner's decisions, with no camera in them (2026-09-30).
 *
 * Everything here is arithmetic over numbers the camera reported — where the outline falls in the video's
 * own pixels, whether that is enough pixels, when a shaken phone has settled, what a refusal means — so it
 * is tested exactly, without a browser, the way `webImageIo`'s interface keeps the gate testable. The IO
 * that feeds it is `liveCamera.ts`; the loop that runs it is `useLiveScan.ts`.
 *
 * ── NO QUALITY FLOOR IS INVENTED HERE ─────────────────────────────────────────────────────────
 * D-SCAN10 holds every blur/glare floor at `null` until recorded samples exist, and Q-AW32 ruled that the
 * browser advisory waits for ~50 recruiter-judged captures. So nothing below compares a sharpness score to
 * a fixed number. The shutter compares a frame to the frames just before it (`settled`) — a RELATIVE
 * question, which needs no floor — and the only absolute threshold, the resolution floor, is read from the
 * gate's own config rather than restated (`meetsResolutionFloor`).
 */
import type { ApplicationCaptureSlot } from "@silvicom/shared";

/**
 * The four photographs the scanner takes. Until 2026-09-30 it took the CDL's two sides only; the owner then
 * ruled that all four Part 1 photo screens look and behave the same (Q-AW53, against its recommendation (b)),
 * so the medical card and the selfie are taken in the page too. A slot the server renames breaks this type.
 */
export type LiveSlot = Extract<ApplicationCaptureSlot, "cdl_front" | "cdl_back" | "medical_card" | "selfie">;
export type LiveFacing = "environment" | "user";

export interface LiveSlotKind {
  /** The camera asked for: the rear for a document, the front for the selfie (AW6, §6.7). */
  facing: LiveFacing;
  /**
   * The outline's shape, which is the document's: an ID-1 card (85.60 × 53.98 mm), a letter-size page
   * (8.5 × 11 in) for the medical examiner's certificate, an upright oval for a face.
   */
  outline: "card" | "page" | "face";
  /** Whether frames are read for a barcode, so the photograph takes itself — the CDL's back only. */
  reads: boolean;
}

/** What differs between the four, said once: the hook, the screen and the tips all read it from here. */
export const LIVE_SLOTS: Record<LiveSlot, LiveSlotKind> = {
  cdl_front: { facing: "environment", outline: "card", reads: false },
  cdl_back: { facing: "environment", outline: "card", reads: true },
  medical_card: { facing: "environment", outline: "page", reads: false },
  selfie: { facing: "user", outline: "face", reads: false },
};

/**
 * Whether the preview is shown mirrored. A front camera's picture, shown as it is, moves the wrong way when the
 * driver moves — everyone's phone mirrors it, so this one does. Only the PREVIEW: the photograph is the video's
 * own pixels, unflipped, so writing on a shirt reads the right way round to the office. One definition, read by
 * the screen's CSS and by the crop (`viewRectToVideo`), so the two cannot disagree about which side is which.
 */
export const mirrored = (slot: LiveSlot): boolean => LIVE_SLOTS[slot].facing === "user";

/**
 * Which set of tips a slot opens on: a document's (glare, background, fill the frame) or a face's. Each is
 * shown once a visit (`scannerTips.ts`), so a driver who has read the licence's tips still meets the selfie's.
 */
export type TipsKind = "document" | "face";
export const tipsKind = (slot: LiveSlot): TipsKind => (LIVE_SLOTS[slot].outline === "face" ? "face" : "document");

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a rectangle on the screen falls in the video's own pixels, for a `<video>` drawn with
 * `object-fit: cover` — scaled until it fills the box, the overflow cropped equally from both sides.
 *
 * ⚠ The camera's resolution is whatever it granted, not what was asked for: Chromium answered a 3840×2160
 * request from a portrait source with 2160×2160 ("crop-and-scale"), measured 2026-09-30. So both sizes are
 * inputs, read at the moment of use, never assumed.
 *
 * `isMirrored`: the preview is drawn flipped left-to-right (`mirrored`, the selfie), so what is under a
 * rectangle on screen is the video's pixels at its REFLECTION across the view's centre line. The selfie's oval
 * is centred, where a rectangle and its reflection are the same — so a wrong answer here would not show today,
 * and would cut the wrong side of the face the day the outline moves off centre. Pinned for that day.
 */
export function viewRectToVideo(rect: Rect, view: Size, video: Size, isMirrored = false): Rect {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const offsetX = (view.width - video.width * scale) / 2;
  const offsetY = (view.height - video.height * scale) / 2;
  const x = isMirrored ? view.width - rect.x - rect.width : rect.x;
  return clampRect(
    {
      x: (x - offsetX) / scale,
      y: (rect.y - offsetY) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    },
    video,
  );
}

/**
 * The outline, grown by `fraction` of its own size on every side and kept inside the frame.
 *
 * The photograph is cut to the outline so the office sees the card, not a truck cab around it — but the
 * outline is a guide the driver lines up by eye, so the cut keeps a margin, and "Use this photo / Retake"
 * shows the result before anything is sent: a corner lost to a careless aim is seen and retaken.
 */
export function withMargin(rect: Rect, fraction: number, bounds: Size): Rect {
  const dx = rect.width * fraction;
  const dy = rect.height * fraction;
  return clampRect({ x: rect.x - dx, y: rect.y - dy, width: rect.width + 2 * dx, height: rect.height + 2 * dy }, bounds);
}

function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.height, rect.y + rect.height);
  return { x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(right - x)), height: Math.max(0, Math.round(bottom - y)) };
}

/**
 * Whether a crop of this size clears the gate's resolution floor — the same number the gate applies to
 * every photograph (`config.gates.resolutionMinLongEdgePx`, 1200), passed in rather than restated.
 *
 * Asked BEFORE the driver aims, from the resolution the camera granted: a phone whose camera answers at
 * 720p would otherwise let a driver line up a licence, press the shutter, and only then be refused for a
 * photograph the scanner could never have produced. Such a phone goes straight to its camera app.
 */
export function meetsResolutionFloor(crop: Size, floorLongEdgePx: number): boolean {
  return Math.max(crop.width, crop.height) >= floorLongEdgePx;
}

/** How the scanner could not start, because what the driver is told — and offered — differs. */
export type LiveRefusal =
  /** No `getUserMedia`, or not a secure context. The camera app is offered. */
  | "unsupported"
  /** The driver, or the phone's settings, said no. Retrying asks nothing new; the camera app still works. */
  | "denied"
  /** No camera answered. */
  | "no_camera"
  /** Another app holds the camera (a video call, the camera app left open). Closing it and retrying can work. */
  | "busy"
  /** It answered, at too few pixels for the gate (`meetsResolutionFloor`). The camera app takes full stills. */
  | "too_low";

/**
 * The `DOMException` names `getUserMedia` rejects with (Media Capture and Streams §10.2), mapped to the
 * five cases above. Anything unrecognised is `busy`: it is the one refusal whose advice — close what
 * else is using the camera and try again — cannot make things worse.
 */
export function classifyCameraError(error: unknown): LiveRefusal {
  const name = error instanceof Error || (typeof error === "object" && error !== null && "name" in error)
    ? String((error as { name: unknown }).name)
    : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no_camera";
    case "TypeError":
      return "unsupported";
    default:
      return "busy";
  }
}

/** One scored frame: when it was on screen and how sharp it measured (`computeMetrics().blurVariance`). */
export interface ScoredFrame {
  at: number;
  sharpness: number;
}

/**
 * How long before the press the frames are looked at, and how long after it the shutter will wait.
 * Timing, not quality: they decide which frames are compared with which, never whether one is good enough.
 */
export const SHUTTER_LOOKBACK_MS = 1500;
export const SHUTTER_DEADLINE_MS = 1200;
/**
 * A frame after the press counts as settled when it is at least this share of the sharpest frame in the
 * look-back. RELATIVE — a proportion of what this camera, on this card, in this light, just produced — so
 * it holds in a dark cab and in sunlight alike, where any absolute number would hold in one of them.
 */
export const SETTLE_SHARE = 0.9;

/**
 * Has the phone settled since the shutter was pressed?
 *
 * Pressing a button on a phone shakes it, so the frame under the finger is the worst one to keep. The
 * frames just BEFORE the press are the driver's own aim, held still — they set the bar, and the first frame
 * after the press that comes back to it is taken. If none does before the deadline, the current one is:
 * the gate and "Use this photo / Retake" still stand between it and the office, and a shutter that never
 * fires is worse than a soft photograph the driver is shown.
 *
 * ⚠ With nothing scored before the press (pressed the instant the preview appeared) there is no bar, so the
 * first frame after it is taken.
 */
export function settled(history: readonly ScoredFrame[], pressedAt: number, frame: ScoredFrame): boolean {
  if (frame.at - pressedAt >= SHUTTER_DEADLINE_MS) return true;
  let bar = 0;
  for (const f of history) {
    if (f.at <= pressedAt && f.at >= pressedAt - SHUTTER_LOOKBACK_MS && f.sharpness > bar) bar = f.sharpness;
  }
  return frame.sharpness >= bar * SETTLE_SHARE;
}

/**
 * How long the scanner shows the frame it kept — green corners and a check — before the review screen
 * (`LiveScanner`). Long enough to register as "that worked", short enough not to read as a wait; a
 * photo that vanishes the instant it is taken reads as a glitch. Timing, not quality, like the two above.
 */
export const TAKEN_HOLD_MS = 650;

/** Keep only what `settled` can still look at, so a scanner left open for minutes holds a few dozen numbers. */
export function trimHistory(history: ScoredFrame[], now: number): void {
  const oldest = now - SHUTTER_LOOKBACK_MS - SHUTTER_DEADLINE_MS;
  while (history.length > 0 && history[0]!.at < oldest) history.shift();
}
