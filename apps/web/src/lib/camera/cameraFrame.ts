/**
 * A live camera's geometry and its refusals, with no camera in them — moved out of `/apply`'s scanner
 * (`features/apply/capture/liveFrame.ts`) in M9c (2026-10-29), when the shop's sticker and Scan page got a
 * camera too. A feature may not import another feature's internals (`lint:boundaries`), and nothing here is
 * about a licence: where a box on screen falls in the video's own pixels, a margin around it, and what a
 * `getUserMedia` rejection means. What stays in `liveFrame.ts` is the applicant's — the four photographs, the
 * resolution floor read from the photo gate, the shutter's settling.
 */

export type LiveFacing = "environment" | "user";

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
 * How a camera could not start, because what the person is told — and offered — differs. The notes on each
 * case are `/apply`'s, where the phone's own camera app is the way round; the shop's camera has the handheld.
 */
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
