import { describe, expect, it } from "vitest";
import { BUNDLED_DEFAULT_CONFIG } from "@silvicom/capture-engine";
import {
  classifyCameraError,
  meetsResolutionFloor,
  settled,
  SETTLE_SHARE,
  SHUTTER_DEADLINE_MS,
  SHUTTER_LOOKBACK_MS,
  trimHistory,
  viewRectToVideo,
  withMargin,
  type ScoredFrame,
} from "./liveFrame";

/**
 * The live scanner's decisions (2026-09-30), without a camera: where the outline falls in the video,
 * whether the camera gave enough pixels, when a phone has settled after the shutter, and what a refusal is.
 */

describe("where the outline falls in the video (object-fit: cover)", () => {
  it("maps a portrait screen onto a landscape video by cropping the sides, as the browser draws it", () => {
    // 390×844 screen, 3840×2160 video: scale = 844/2160, the video is 1500.4 px wide on screen, centred.
    const view = { width: 390, height: 844 };
    const video = { width: 3840, height: 2160 };
    const scale = 844 / 2160;
    const offsetX = (390 - 3840 * scale) / 2;
    const r = viewRectToVideo({ x: 20, y: 300, width: 350, height: 220 }, view, video);
    expect(r.x).toBe(Math.round((20 - offsetX) / scale));
    expect(r.y).toBe(Math.round(300 / scale));
    expect(r.width).toBe(Math.round(350 / scale));
    expect(r.height).toBe(Math.round(220 / scale));
  });

  it("maps a square video — the size Chromium actually granted for a 3840×2160 request — the same way", () => {
    const r = viewRectToVideo({ x: 0, y: 0, width: 390, height: 844 }, { width: 390, height: 844 }, { width: 2160, height: 2160 });
    // Fills the height; the whole visible screen is the middle 998 px of the video's width.
    expect(r.y).toBe(0);
    expect(r.height).toBe(2160);
    expect(r.width).toBe(Math.round(390 / (844 / 2160)));
  });

  it("never reaches outside the frame, whatever the rectangle asked for", () => {
    const r = viewRectToVideo({ x: -50, y: -50, width: 1000, height: 1000 }, { width: 400, height: 400 }, { width: 800, height: 800 });
    expect(r).toEqual({ x: 0, y: 0, width: 800, height: 800 });
  });
});

describe("the cut around the outline", () => {
  it("grows by the fraction on every side", () => {
    expect(withMargin({ x: 100, y: 100, width: 200, height: 100 }, 0.1, { width: 1000, height: 1000 })).toEqual({
      x: 80, y: 90, width: 240, height: 120,
    });
  });

  it("stops at the frame's edge rather than inventing pixels beyond it", () => {
    expect(withMargin({ x: 5, y: 5, width: 200, height: 100 }, 0.1, { width: 210, height: 1000 })).toEqual({
      x: 0, y: 0, width: 210, height: 115,
    });
  });
});

describe("the resolution floor, read from the gate", () => {
  const floor = BUNDLED_DEFAULT_CONFIG.gates.resolutionMinLongEdgePx;

  it("is the gate's own number, so the scanner and the gate cannot disagree", () => {
    expect(floor).toBe(1200);
  });

  it("refuses a crop one pixel short of it, and accepts one at it, on either orientation", () => {
    expect(meetsResolutionFloor({ width: floor - 1, height: 700 }, floor)).toBe(false);
    expect(meetsResolutionFloor({ width: 700, height: floor }, floor)).toBe(true);
  });
});

describe("what a refusal means", () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no_camera"],
    ["OverconstrainedError", "no_camera"],
    ["TypeError", "unsupported"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
  ] as const)("%s is %s", (name, expected) => {
    expect(classifyCameraError(named(name))).toBe(expected);
  });

  it("reads a DOMException-shaped object as well as an Error, and treats the unknown as busy", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyCameraError("something odd")).toBe("busy");
    expect(classifyCameraError(undefined)).toBe("busy");
  });
});

describe("the shutter waits for the phone to settle", () => {
  const PRESS = 10_000;
  const aim: ScoredFrame[] = [
    { at: PRESS - 2000, sharpness: 900 }, // before the look-back: must not set the bar
    { at: PRESS - 1000, sharpness: 400 },
    { at: PRESS - 200, sharpness: 500 },
  ];

  it("refuses the shaken frame under the finger and takes the first that comes back to the driver's aim", () => {
    expect(settled(aim, PRESS, { at: PRESS + 100, sharpness: 200 })).toBe(false);
    expect(settled(aim, PRESS, { at: PRESS + 300, sharpness: 500 * SETTLE_SHARE })).toBe(true);
  });

  it("sets the bar from the look-back only — an older, sharper frame does not raise it", () => {
    expect(settled(aim, PRESS, { at: PRESS + 100, sharpness: 460 })).toBe(true);
    expect(settled([{ at: PRESS - SHUTTER_LOOKBACK_MS - 1, sharpness: 900 }], PRESS, { at: PRESS + 1, sharpness: 1 })).toBe(true);
  });

  it("takes the current frame at the deadline, so a shutter always fires", () => {
    expect(settled(aim, PRESS, { at: PRESS + SHUTTER_DEADLINE_MS - 1, sharpness: 1 })).toBe(false);
    expect(settled(aim, PRESS, { at: PRESS + SHUTTER_DEADLINE_MS, sharpness: 1 })).toBe(true);
  });

  it("with nothing scored before the press, takes the first frame after it", () => {
    expect(settled([], PRESS, { at: PRESS + 16, sharpness: 0 })).toBe(true);
  });

  it("forgets what it can no longer look at", () => {
    const h: ScoredFrame[] = [{ at: 0, sharpness: 1 }, { at: 5000, sharpness: 1 }];
    trimHistory(h, 5000 + 100);
    expect(h).toEqual([{ at: 5000, sharpness: 1 }]);
  });
});

describe("what the camera is asked for", () => {
  /**
   * Measured 2026-09-30 (the comment on `LIVE_CONSTRAINTS`): a landscape-shaped request from a portrait camera
   * is met by cropping to a square. Pinned here because it is the kind of line a tidy-up "fixes" to 3840×2160.
   */
  it("asks for the same ideal on both sides, so an upright phone is never cropped to a square", async () => {
    const { LIVE_CONSTRAINTS } = await import("./liveCamera");
    const video = LIVE_CONSTRAINTS.video as MediaTrackConstraints;
    expect(video.width).toEqual(video.height);
    expect(video.facingMode).toEqual({ ideal: "environment" });
  });
});
