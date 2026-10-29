import { describe, expect, it } from "vitest";
import { classifyCameraError, viewRectToVideo, withMargin } from "./cameraFrame";

/**
 * A live camera's geometry and refusals, without a camera — moved here from `/apply`'s `liveFrame.test.ts` with
 * the code (M9c, 2026-10-29). `/apply`'s scanner and the shop's barcode camera both stand on these.
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

  it("under a mirrored preview, maps a rectangle to its REFLECTION — the face framed on screen is the face cut", () => {
    // A 1000-wide video drawn 1:1 in a 1000-wide view: no scaling, so only the flip moves anything.
    const view = { width: 1000, height: 1000 };
    const video = { width: 1000, height: 1000 };
    const leftOfScreen = { x: 100, y: 300, width: 200, height: 400 };
    expect(viewRectToVideo(leftOfScreen, view, video)).toEqual(leftOfScreen);
    expect(viewRectToVideo(leftOfScreen, view, video, true)).toEqual({ x: 700, y: 300, width: 200, height: 400 });
    // The selfie's oval is centred, and a centred rectangle is its own reflection.
    const centred = { x: 400, y: 300, width: 200, height: 400 };
    expect(viewRectToVideo(centred, view, video, true)).toEqual(centred);
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
