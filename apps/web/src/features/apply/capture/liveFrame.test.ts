import { describe, expect, it } from "vitest";
import { BUNDLED_DEFAULT_CONFIG } from "@silvicom/capture-engine";
import {
  classifyCameraError,
  LIVE_SLOTS,
  meetsResolutionFloor,
  mirrored,
  settled,
  SETTLE_SHARE,
  SHUTTER_DEADLINE_MS,
  SHUTTER_LOOKBACK_MS,
  tipsKind,
  trimHistory,
  viewRectToVideo,
  withMargin,
  type ScoredFrame,
} from "./liveFrame";
import { CROP_MARGIN } from "./useLiveScan";

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

describe("the resolution floor, read from the gate", () => {
  const floor = BUNDLED_DEFAULT_CONFIG.gates.resolutionMinLongEdgePx;

  it("is the gate's own number, so the scanner and the gate cannot disagree", () => {
    expect(floor).toBe(1200);
  });

  it("refuses a crop one pixel short of it, and accepts one at it, on either orientation", () => {
    expect(meetsResolutionFloor({ width: floor - 1, height: 700 }, floor)).toBe(false);
    expect(meetsResolutionFloor({ width: 700, height: floor }, floor)).toBe(true);
  });

  /**
   * The medical card's page and the selfie's oval under an upright phone's PORTRAIT camera, at the outlines
   * the built app actually drew — measured 2026-09-30 in Chromium (`e2e-apply`, a 2160×3840 fake camera):
   * the view and the outline in CSS px, at 390×844, 320×844 and a short 375×667 phone. The cut is the
   * outline plus `CROP_MARGIN`, exactly as `useLiveScan` makes it.
   *
   * At 4K both clear the floor everywhere. At 1080p (a common front camera, and an older rear one) the page
   * clears it on a tall phone and not on a short one, where it is sized by the height — such a phone is sent
   * to its camera app before the driver aims, which is the refusal working, not failing. (The CDL's card, for
   * comparison, is ~1,064 px at 1080p on a 390 px phone and is refused there too.)
   */
  const MEASURED = {
    "390×844": { view: { width: 390, height: 568 }, page: { x: 23.4, y: 61.9, width: 343.2, height: 444.1 }, face: { x: 39, y: 76, width: 312, height: 416 } },
    "320×844": { view: { width: 320, height: 568 }, page: { x: 19.2, y: 101.8, width: 281.6, height: 364.4 }, face: { x: 32, y: 113.3, width: 256, height: 341.3 } },
    "375×667": { view: { width: 375, height: 391 }, page: { x: 66.6, y: 39.1, width: 241.7, height: 312.8 }, face: { x: 64.3, y: 31.3, width: 246.3, height: 328.4 } },
  } as const;
  const cutLongEdge = (at: keyof typeof MEASURED, outline: "page" | "face", video: { width: number; height: number }) => {
    const m = MEASURED[at];
    const c = withMargin(viewRectToVideo(m[outline], m.view, video, outline === "face"), CROP_MARGIN, video);
    return { ok: meetsResolutionFloor(c, floor), long: Math.max(c.width, c.height) };
  };

  it.each(Object.keys(MEASURED) as (keyof typeof MEASURED)[])("at %s, a 4K portrait camera clears it for the page and the face", (at) => {
    const portrait4k = { width: 2160, height: 3840 };
    expect(cutLongEdge(at, "page", portrait4k).ok).toBe(true);
    expect(cutLongEdge(at, "face", portrait4k).ok).toBe(true);
  });

  it("at 1080p, the page and the face clear it on a tall phone and are refused on a short one", () => {
    const portrait1080 = { width: 1080, height: 1920 };
    expect(cutLongEdge("390×844", "page", portrait1080)).toMatchObject({ ok: true });
    expect(cutLongEdge("390×844", "face", portrait1080)).toMatchObject({ ok: true });
    expect(cutLongEdge("320×844", "face", portrait1080)).toMatchObject({ ok: true });
    expect(cutLongEdge("375×667", "page", portrait1080)).toMatchObject({ ok: false });
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

  it("asks for the front camera for the selfie, at the same aspect-neutral ideal, and the rear for the rest", async () => {
    const { LIVE_CONSTRAINTS, liveConstraints } = await import("./liveCamera");
    const front = liveConstraints("user").video as MediaTrackConstraints;
    expect(front.facingMode).toEqual({ ideal: "user" });
    expect(front.width).toEqual(front.height);
    expect(front.width).toEqual((LIVE_CONSTRAINTS.video as MediaTrackConstraints).width);
    expect(LIVE_SLOTS.selfie.facing).toBe("user");
    for (const slot of ["cdl_front", "cdl_back", "medical_card"] as const) expect(LIVE_SLOTS[slot].facing).toBe("environment");
  });
});

describe("what each photograph is", () => {
  it("frames the CDL as a card, the medical card as a page and the selfie as a face; only the CDL's back reads", () => {
    expect(Object.fromEntries(Object.entries(LIVE_SLOTS).map(([k, v]) => [k, [v.outline, v.reads]]))).toEqual({
      cdl_front: ["card", false],
      cdl_back: ["card", true],
      medical_card: ["page", false],
      selfie: ["face", false],
    });
  });

  it("mirrors the selfie's preview and nothing else", () => {
    expect(mirrored("selfie")).toBe(true);
    for (const slot of ["cdl_front", "cdl_back", "medical_card"] as const) expect(mirrored(slot)).toBe(false);
  });

  it("gives the selfie a face's tips and every document the document's", () => {
    expect(tipsKind("selfie")).toBe("face");
    for (const slot of ["cdl_front", "cdl_back", "medical_card"] as const) expect(tipsKind(slot)).toBe("document");
  });
});
