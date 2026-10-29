import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { LiveCamera, OpenResult } from "./liveCamera";
import { READ_EVERY_MS, useBarcodeCamera, type BarcodeCameraOptions, type BarcodeReader } from "./useBarcodeCamera";

/**
 * The shop's barcode camera loop (M9c), with the camera, the decoder and the frames all handed in — what is
 * proven here is what it DECIDES: what is passed on, how often, and when it stops. The decoder itself is
 * `features/inventory/shopBarcodeFormats.test.ts`'s, against real barcodes.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: { once?: boolean; reads?: string[][]; open?: OpenResult | "pending"; load?: () => Promise<BarcodeReader> } = {}) {
  const frames: Array<() => void> = [];
  let t = 0;
  const stop = vi.fn();
  const ended: Array<() => void> = [];
  const sampled: Array<{ x: number; y: number; width: number; height: number }> = [];
  const camera: LiveCamera = {
    size: () => ({ width: 1920, height: 1080 }),
    sample: (crop) => (sampled.push(crop), { width: 1, height: 1 } as ImageData),
    snapshot: () => {
      throw new Error("the barcode camera never keeps a frame");
    },
    onEnded: (l) => ended.push(l),
    torch: null,
    stop,
  };
  const queue = [...(opts.reads ?? [])];
  const reader = vi.fn<BarcodeReader>(async () => queue.shift() ?? []);
  const onRead = vi.fn();
  const scope = effectScope();
  const video = ref(document.createElement("video"));
  const options: BarcodeCameraOptions = {
    reader: { formats: ["Code128"] },
    once: opts.once,
    onRead,
    aim: () => ({ rect: { x: 0, y: 270, width: 960, height: 270 }, view: { width: 960, height: 540 } }),
    open: async () => (opts.open && opts.open !== "pending" ? opts.open : { ok: true, camera }),
    load: opts.load ?? (async () => reader),
    now: () => t,
    nextFrame: (_v, cb) => frames.push(cb),
  };
  const cam = scope.run(() => useBarcodeCamera(video, options))!;
  /** Advance the clock and run every frame callback asked for (a stale session's too), then let reads settle. */
  async function frame(ms = READ_EVERY_MS) {
    t += ms;
    for (const cb of frames.splice(0)) cb();
    await flush();
  }
  return { cam, frame, frames, reader, onRead, stop, ended, sampled, scope };
}

afterEach(() => vi.restoreAllMocks());

describe("what the camera passes on", () => {
  it("passes each barcode once per opening, however many frames it stays under the box", async () => {
    const h = harness({ reads: [["356938035643809"], ["356938035643809"], ["356938035643809", "R52W70ABCDE"], ["356938035643809"]] });
    await h.cam.start();
    expect(h.cam.state.value).toBe("reading");
    for (let i = 0; i < 4; i += 1) await h.frame();
    expect(h.onRead.mock.calls.map((c) => c[0])).toEqual(["356938035643809", "R52W70ABCDE"]);
    expect(h.cam.reads.value).toBe(2);
  });

  it("reads again after it is reopened — a second tablet's identical model is a new read", async () => {
    const h = harness({ reads: [["SM-T575"], ["SM-T575"]] });
    await h.cam.start();
    await h.frame();
    await h.cam.start();
    expect(h.cam.reads.value).toBe(0);
    await h.frame();
    expect(h.onRead).toHaveBeenCalledTimes(2);
  });

  it("with `once`, stops and lets the camera go after the first read", async () => {
    const h = harness({ once: true, reads: [["SIL1:BIN:7K3M9P", "036000291452"], ["036000291452"]] });
    await h.cam.start();
    await h.frame();
    expect(h.onRead.mock.calls.map((c) => c[0])).toEqual(["SIL1:BIN:7K3M9P"]);
    expect(h.cam.state.value).toBe("done");
    expect(h.stop).toHaveBeenCalled();
    await h.frame();
    expect(h.onRead).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty text and trims what it passes", async () => {
    const h = harness({ reads: [["  ", " SM-T575 "]] });
    await h.cam.start();
    await h.frame();
    expect(h.onRead.mock.calls).toEqual([["SM-T575"]]);
  });
});

describe("how often it reads, and what", () => {
  it("reads at most every READ_EVERY_MS, and one read at a time", async () => {
    const h = harness();
    await h.cam.start();
    await h.frame(READ_EVERY_MS);
    await h.frame(READ_EVERY_MS / 2);
    expect(h.reader).toHaveBeenCalledTimes(1);
    await h.frame(READ_EVERY_MS / 2);
    expect(h.reader).toHaveBeenCalledTimes(2);
  });

  it("reads only the strip under the aiming box, in the video's own pixels", async () => {
    const h = harness();
    await h.cam.start();
    await h.frame();
    // A 960×540 view over a 1920×1080 video is a 2× scale: the box's lower half of the view is the video's.
    expect(h.sampled[0]).toEqual({ x: 0, y: 540, width: 1920, height: 540 });
  });

  it("passes the caller's formats to the decoder", async () => {
    const h = harness();
    await h.cam.start();
    await h.frame();
    expect(h.reader.mock.calls[0]![1]).toEqual({ formats: ["Code128"] });
  });

  it("keeps reading after a decoder error on one frame", async () => {
    const h = harness();
    h.reader.mockRejectedValueOnce(new Error("frame")).mockResolvedValueOnce(["SM-T575"]);
    await h.cam.start();
    await h.frame();
    await h.frame();
    expect(h.onRead).toHaveBeenCalledWith("SM-T575");
  });
});

describe("when it cannot read", () => {
  it("says the camera's refusal and holds no camera", async () => {
    const h = harness({ open: { ok: false, refusal: "denied" } });
    await h.cam.start();
    expect(h.cam.state.value).toBe("refused");
    expect(h.cam.refusal.value).toBe("denied");
    expect(h.frames).toHaveLength(0);
  });

  it("says the decoder did not load as its own refusal, and lets the camera go", async () => {
    const h = harness({ load: () => Promise.reject(new Error("offline")) });
    await h.cam.start();
    expect(h.cam.refusal.value).toBe("no_reader");
    expect(h.stop).toHaveBeenCalled();
  });

  it("is busy when the camera stops under it, and stops reading", async () => {
    const h = harness({ reads: [["SM-T575"]] });
    await h.cam.start();
    h.ended[0]!();
    expect(h.cam.refusal.value).toBe("busy");
    await h.frame();
    expect(h.reader).not.toHaveBeenCalled();
  });

  it("lets the camera go when its screen is closed", async () => {
    const h = harness();
    await h.cam.start();
    h.scope.stop();
    expect(h.stop).toHaveBeenCalled();
    await h.frame();
    expect(h.reader).not.toHaveBeenCalled();
  });
});
