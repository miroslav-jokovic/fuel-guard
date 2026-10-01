import { classifyCameraError, type LiveFacing, type LiveRefusal, type Rect, type Size } from "./liveFrame";

/**
 * The phone's camera inside the page — the browser half of the live scanner (2026-09-30).
 *
 * Behind an interface for the reason `webImageIo` is: what the scanner DECIDES (`liveFrame.ts`,
 * `useLiveScan.ts`) must be testable without a camera, so a test hands in its own `LiveCamera`. This file is
 * the only one that touches `getUserMedia`, a `<video>` and a canvas.
 *
 * ── WHY THIS EXISTS BESIDE THE CAMERA APP (amends D-APP11 / D-AW9, owner 2026-09-30) ─────────────
 * D-APP11 chose the phone's own camera app partly because "iOS Safari's `getUserMedia` does not give full
 * resolution and autofocus". Re-checked 2026-09-30: current iPhones grant up to 3840×2160 to a page (the old
 * cap was iOS 11's 1280×720), and focus is the camera's own continuous autofocus — a page cannot steer it,
 * but it is not off. Neither is proven on a real iPhone from here, so nothing depends on it: the resolution
 * the camera actually grants is measured on every open (`meetsResolutionFloor`), a phone that falls short is
 * sent to its camera app, and the camera app is one press away inside the scanner at all times.
 */

export interface LiveCamera {
  /** What the camera granted — never what was asked for (`liveFrame.viewRectToVideo`). */
  size(): Size;
  /** The crop of the frame on screen now, downscaled so its long edge is at most `longEdge`. */
  sample(crop: Rect, longEdge: number): ImageData;
  /**
   * The crop of the frame on screen now at full resolution, HELD — so the frame the barcode was read from is
   * the one kept, not the one that happens to be on screen once the read finishes.
   */
  snapshot(crop: Rect): Snapshot;
  /** Called once if the camera stops on its own (another app took it; the phone locked). */
  onEnded(listener: () => void): void;
  /**
   * The phone's flashlight, or null where the page cannot reach it. Resolves with whether the camera took
   * the change — a constraint the camera refuses rejects, and the button must not then claim the light is on.
   */
  torch: ((on: boolean) => Promise<boolean>) | null;
  stop(): void;
}

export interface Snapshot {
  size: Size;
  /** The held frame, downscaled so its long edge is at most `longEdge`. */
  pixels(longEdge: number): ImageData;
  /** The held frame as the photograph — a JPEG the capture pipeline then gates, downscales and strips. */
  toFile(): Promise<File>;
}

export type OpenResult = { ok: true; camera: LiveCamera } | { ok: false; refusal: LiveRefusal };

/**
 * A camera at the most pixels it will give — the rear one for a document, the front one for the selfie
 * (`liveFrame.LIVE_SLOTS`). `ideal`, never `exact`: an unmet `exact` rejects the whole request, and a camera at
 * 1920×1080 is still a camera — whether it is enough is `meetsResolutionFloor`'s call, made on what came back.
 * The same holds for the facing: a phone or a laptop with one camera answers `user` with the one it has.
 *
 * ⚠ **The SAME ideal on both sides — no aspect ratio.** A phone held upright is a portrait camera, and a
 * landscape-shaped request is honoured by CROPPING: measured 2026-09-30 in Chromium against a 2160×3840 source,
 * `3840 × 2160` came back 2160×2160 (44% of the pixels thrown away), while `4096 × 4096`, `width` alone and no
 * size at all all came back at the full 2160×3840. `4096 × 4096` keeps asking for the most without choosing a shape.
 */
export const liveConstraints = (facing: LiveFacing): MediaStreamConstraints => ({
  audio: false,
  video: { facingMode: { ideal: facing }, width: { ideal: 4096 }, height: { ideal: 4096 } },
});
/** The documents' request, unchanged since the CDL scanner shipped. */
export const LIVE_CONSTRAINTS: MediaStreamConstraints = liveConstraints("environment");

/**
 * The photograph's JPEG quality. It is re-encoded once more by the capture pipeline (WebP at the model-facing
 * edge), so it is kept near-lossless here: the second encode should be the only one that costs detail.
 */
const SNAPSHOT_JPEG_QUALITY = 0.95;

export async function openLiveCamera(video: HTMLVideoElement, facing: LiveFacing = "environment"): Promise<OpenResult> {
  if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, refusal: "unsupported" };
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(liveConstraints(facing));
  } catch (e) {
    return { ok: false, refusal: classifyCameraError(e) };
  }
  // iOS Safari plays a camera stream inline only when the element is muted and `playsinline`; without them
  // it opens its own full-screen player over the page.
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  try {
    await video.play();
    if (video.videoWidth === 0) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    return { ok: false, refusal: classifyCameraError(e) };
  }
  return { ok: true, camera: browserCamera(video, stream) };
}

function browserCamera(video: HTMLVideoElement, stream: MediaStream): LiveCamera {
  // Reused, not created per frame: a phone scoring five frames a second should not allocate five canvases.
  const sampler = document.createElement("canvas");
  const sampleCtx = context(sampler, true);
  let stopped = false;

  return {
    size: () => ({ width: video.videoWidth, height: video.videoHeight }),
    sample: (crop, longEdge) => drawScaled(sampleCtx, video, crop, longEdge),
    snapshot(crop) {
      const held = document.createElement("canvas");
      held.width = crop.width;
      held.height = crop.height;
      context(held, false).drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return {
        size: { width: crop.width, height: crop.height },
        pixels: (longEdge) => drawScaled(sampleCtx, held, { x: 0, y: 0, width: crop.width, height: crop.height }, longEdge),
        toFile: () =>
          new Promise<File>((resolve, reject) =>
            held.toBlob(
              (blob) => (blob ? resolve(new File([blob], "licence.jpg", { type: "image/jpeg" })) : reject(new Error("This browser could not save the photo."))),
              "image/jpeg",
              SNAPSHOT_JPEG_QUALITY,
            ),
          ),
      };
    },
    torch: torchControl(stream.getVideoTracks()[0]),
    onEnded(listener) {
      for (const t of stream.getVideoTracks()) t.addEventListener("ended", () => !stopped && listener(), { once: true });
    },
    stop() {
      stopped = true;
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}

/**
 * The flashlight, where the camera says it has one. `torch` is in the Image Capture spec's constraint
 * extensions, not in TypeScript's DOM types, hence the widening. Measured, never assumed: Chrome on Android
 * reports it for a rear camera with a light; iOS Safari has not reported it, so an iPhone shows no button
 * rather than one that does nothing. Stopping the track (`stop`) turns the light off with it.
 */
function torchControl(track: MediaStreamTrack | undefined): LiveCamera["torch"] {
  const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  if (!track || capabilities?.torch !== true) return null;
  return async (on) => {
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  };
}

function context(canvas: HTMLCanvasElement, willReadFrequently: boolean): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently });
  if (!ctx) throw new Error("This browser cannot process the photo.");
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function drawScaled(ctx: CanvasRenderingContext2D, source: CanvasImageSource, crop: Rect, longEdge: number): ImageData {
  const scale = Math.min(1, longEdge / Math.max(crop.width, crop.height));
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  ctx.canvas.width = width;
  ctx.canvas.height = height;
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
