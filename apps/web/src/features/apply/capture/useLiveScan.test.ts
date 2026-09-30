import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { AamvaLicence } from "@silvicom/shared";
import type { LiveCamera, OpenResult, Snapshot } from "./liveCamera";
import { SHUTTER_DEADLINE_MS } from "./liveFrame";
import { useLiveScan, type LiveCapture, type LiveScanOptions } from "./useLiveScan";

/**
 * One session of the live licence scanner (2026-09-30), with the camera, the barcode reader, the clock and
 * the frames all in the test's hands: what is refused before the driver aims, what the back takes by itself,
 * what the shutter waits for, and that nothing outlives the session.
 */

const VIEW = { width: 390, height: 844 };
/** A 3840×2160 video under a 390×844 screen: an outline 350 px wide is ~896 px of video. */
const OUTLINE = { x: 20, y: 300, width: 350, height: 220 };
const LICENCE = { documentNumber: "D1234567" } as unknown as AamvaLicence;

function fakeCamera(size = { width: 2160, height: 3840 }) {
  const ended: Array<() => void> = [];
  const snaps: Snapshot[] = [];
  const camera: LiveCamera & { stopped: boolean; snaps: Snapshot[]; end: () => void } = {
    stopped: false,
    snaps,
    size: () => size,
    sample: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as ImageData,
    snapshot: (crop) => {
      const n = snaps.length + 1;
      const snap: Snapshot = {
        size: { width: crop.width, height: crop.height },
        pixels: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as ImageData,
        toFile: async () => new File([`frame-${n}`], "licence.jpg", { type: "image/jpeg" }),
      };
      snaps.push(snap);
      return snap;
    },
    onEnded: (l) => ended.push(l),
    stop() {
      this.stopped = true;
    },
    end: () => ended.forEach((l) => l()),
  };
  return camera;
}

function harness(over: Partial<LiveScanOptions> & { camera?: ReturnType<typeof fakeCamera>; opened?: OpenResult } = {}) {
  const camera = over.camera ?? fakeCamera();
  const captures: LiveCapture[] = [];
  const frames: Array<() => void> = [];
  let clock = 0;
  const scope = effectScope();
  const scan = scope.run(() =>
    useLiveScan(ref(document.createElement("video")), {
      side: "front",
      onCapture: (c) => captures.push(c),
      outline: () => ({ rect: OUTLINE, view: VIEW }),
      open: async () => over.opened ?? { ok: true, camera },
      read: async () => null,
      score: () => 100,
      now: () => clock,
      nextFrame: (_v, cb) => frames.push(cb),
      ...over,
    }),
  )!;
  /** Advance the clock and run the one pending frame callback. */
  const frame = async (advanceMs = 120): Promise<void> => {
    clock += advanceMs;
    const cb = frames.shift();
    cb?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { scan, camera, captures, frames, frame, scope, at: () => clock };
}

afterEach(() => vi.restoreAllMocks());

describe("before the driver aims", () => {
  it("opens, measures what the camera granted, and starts looking at frames", async () => {
    const h = harness();
    await h.scan.start();
    expect(h.scan.state.value).toBe("aiming");
    expect(h.frames).toHaveLength(1);
  });

  it("refuses a camera whose pixels under the outline fall short of the gate's floor — before any aiming", async () => {
    // 1280×720 landscape under a portrait screen: the outline covers ~ 300 px of video.
    const h = harness({ camera: fakeCamera({ width: 1280, height: 720 }) });
    await h.scan.start();
    expect(h.scan.state.value).toBe("refused");
    expect(h.scan.refusal.value).toBe("too_low");
    expect(h.camera.stopped).toBe(true);
    expect(h.frames).toHaveLength(0);
  });

  it("passes on what getUserMedia said", async () => {
    const h = harness({ opened: { ok: false, refusal: "denied" } });
    await h.scan.start();
    expect(h.scan.refusal.value).toBe("denied");
  });
});

describe("the back takes itself", () => {
  it("keeps the frame whose barcode read, with the licence it read, and stops the camera", async () => {
    let reads = 0;
    const h = harness({ side: "back", read: async () => (++reads === 2 ? LICENCE : null) });
    await h.scan.start();
    await h.frame(300); // read 1: nothing
    await h.frame(300); // read 2: the licence
    await Promise.resolve();
    expect(h.captures).toHaveLength(1);
    expect(h.captures[0]!.licence).toBe(LICENCE);
    // The frame kept is the one READ (snapshot 2), not whatever was on screen when the read finished.
    expect(await h.captures[0]!.file.text()).toBe("frame-2");
    expect(h.camera.stopped).toBe(true);
  });

  it("never has two reads in flight, however slow a read is", async () => {
    const read = vi.fn(() => new Promise<AamvaLicence | null>(() => {}));
    const h = harness({ side: "back", read });
    await h.scan.start();
    await h.frame(300);
    await h.frame(300);
    await h.frame(300);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("the front never reads at all", async () => {
    const read = vi.fn(async () => LICENCE);
    const h = harness({ side: "front", read });
    await h.scan.start();
    await h.frame(300);
    await h.frame(300);
    expect(read).not.toHaveBeenCalled();
    expect(h.captures).toHaveLength(0);
  });
});

describe("the shutter", () => {
  it("does not take the shaken frame under the finger; it takes the first as sharp as the aim before it", async () => {
    const scores = [500, 500, 100, 480];
    const h = harness({ score: () => scores.shift() ?? 0 });
    await h.scan.start();
    await h.frame(); // 500
    await h.frame(); // 500 — the aim
    h.scan.shutter();
    expect(h.scan.state.value).toBe("settling");
    await h.frame(); // 100 — shaken
    expect(h.captures).toHaveLength(0);
    await h.frame(); // 480 ≥ 0.9 × 500
    await Promise.resolve();
    expect(h.captures).toHaveLength(1);
    expect(h.captures[0]!.licence).toBeNull();
  });

  it("fires at the deadline even if the phone never settles", async () => {
    const scores = [500, 10, 10, 10];
    const h = harness({ score: () => scores.shift() ?? 10 });
    await h.scan.start();
    await h.frame();
    h.scan.shutter();
    await h.frame(SHUTTER_DEADLINE_MS / 2);
    expect(h.captures).toHaveLength(0);
    await h.frame(SHUTTER_DEADLINE_MS / 2);
    await Promise.resolve();
    expect(h.captures).toHaveLength(1);
  });

  it("does nothing unless the camera is live", async () => {
    const h = harness({ opened: { ok: false, refusal: "busy" } });
    await h.scan.start();
    h.scan.shutter();
    expect(h.scan.state.value).toBe("refused");
  });
});

describe("nothing outlives the session", () => {
  it("a camera that ends on its own is a refusal the driver is told about, not a frozen picture", async () => {
    const h = harness();
    await h.scan.start();
    h.camera.end();
    expect(h.scan.state.value).toBe("refused");
    expect(h.scan.refusal.value).toBe("busy");
  });

  it("a read that finishes after the scanner was closed takes nothing", async () => {
    let finish: (l: AamvaLicence | null) => void = () => {};
    const h = harness({ side: "back", read: () => new Promise((r) => (finish = r)) });
    await h.scan.start();
    await h.frame(300);
    h.scan.stop();
    finish(LICENCE);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.captures).toHaveLength(0);
    expect(h.camera.stopped).toBe(true);
  });

  it("stops the camera when its scope ends — a screen left mid-aim does not keep the camera light on", async () => {
    const h = harness();
    await h.scan.start();
    h.scope.stop();
    expect(h.camera.stopped).toBe(true);
  });

  it("releases the camera when the phone locks and opens it again when the page comes back", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => ({ ok: true, camera: fakeCamera() }));
    const h = harness({ open });
    await h.scan.start();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
