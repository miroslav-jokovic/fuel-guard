import { computed, onScopeDispose, ref, shallowRef, type Ref } from "vue";
import { BUNDLED_DEFAULT_CONFIG, computeMetrics } from "@silvicom/capture-engine";
import type { AamvaLicence } from "@silvicom/shared";
import { openLiveCamera, type LiveCamera, type OpenResult, type Snapshot } from "./liveCamera";
import {
  LIVE_SLOTS,
  meetsResolutionFloor,
  mirrored,
  settled,
  trimHistory,
  viewRectToVideo,
  withMargin,
  type LiveFacing,
  type LiveRefusal,
  type LiveSlot,
  type Rect,
  type ScoredFrame,
  type Size,
} from "./liveFrame";
import { readLicenceBarcode } from "./readLicenceBarcode";

/**
 * One session of the live scanner (2026-09-30): the camera open in the page, an outline over it, and the
 * moment a photograph is taken. Which camera, which outline and whether frames are read all come from the
 * slot (`liveFrame.LIVE_SLOTS`).
 *
 * ── HOW EACH PHOTOGRAPH IS TAKEN ──────────────────────────────────────────────────────────────
 * **The CDL's back takes itself.** Its PDF417 is read from the live frames, and the frame whose barcode READ is
 * the one kept — the most objective "this photograph is sharp enough" there is, and it needs no threshold.
 * The licence it read comes along, so the page can say so at once.
 *
 * **The CDL's front, the medical card and the selfie wait for the shutter** — there is nothing on them to
 * read. (The medical card is not looked for either: finding a page's edges and squaring it up is Q-AW53's
 * option (a), a multi-MB OpenCV download, so its outline is an aiming guide and the cut is the outline's.) The shutter does not take the frame
 * under the finger (pressing shakes the phone); it takes the first one after the press that is as sharp as
 * the driver's own aim just before it (`liveFrame.settled`). Auto-capturing the front would need a fixed
 * sharpness floor, which D-SCAN10 forbids until Q-AW32's samples exist — so it is not built.
 *
 * ── WHAT IS MEASURED, AND AT WHAT SCALE ───────────────────────────────────────────────────────
 * Sharpness is `computeMetrics().blurVariance` — the ONE definition (D-SCAN8, `lint:scanner-parity`), never a
 * second Laplacian written here. It is computed on a small copy the browser drew, whose resampler is not the
 * server's; that is sound only because the numbers are compared with EACH OTHER, from one camera within two
 * seconds, and never with a floor. Do not start comparing them with one.
 */

export type LiveScanState = "starting" | "aiming" | "settling" | "taking" | "refused";

export interface LiveCapture {
  file: File;
  /** The CDL back's barcode, read from the very frame kept; null for every other photograph. */
  licence: AamvaLicence | null;
}

export interface LiveScanOptions {
  slot: LiveSlot;
  onCapture: (capture: LiveCapture) => void;
  /** The outline on screen and the box the video is drawn in, both in CSS pixels; null until laid out. */
  outline: () => { rect: Rect; view: Size } | null;
  open?: (video: HTMLVideoElement, facing: LiveFacing) => Promise<OpenResult>;
  read?: (pixels: ImageData) => Promise<AamvaLicence | null>;
  score?: (pixels: ImageData) => number;
  now?: () => number;
  /** Run `callback` on the video's next frame; a test drives the frames itself. */
  nextFrame?: (video: HTMLVideoElement, callback: () => void) => void;
}

/** Share of the outline added on every side of the cut (`liveFrame.withMargin` says why there is one). */
export const CROP_MARGIN = 0.06;
/** How often a frame is scored, and at what size. Scoring is a ranking, so a small copy is enough. */
const SCORE_EVERY_MS = 100;
const SCORE_LONG_EDGE = 480;
/** How often the back's barcode is tried, at most — and one read at a time, however long a read takes. */
const READ_EVERY_MS = 250;
/**
 * The long edge a read is made at. A licence's PDF417 is ~13–17 data columns, a few hundred modules across;
 * at 1600 px over the card that is ~3 px a module, which zxing reads, and a 4K crop is read ~2× faster.
 */
const READ_LONG_EDGE = 1600;

const sharpness = (pixels: ImageData): number =>
  computeMetrics(new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), pixels.width, pixels.height, SCORE_LONG_EDGE, 4)
    .blurVariance;

export function useLiveScan(video: Ref<HTMLVideoElement | null>, options: LiveScanOptions) {
  const state = ref<LiveScanState>("starting");
  const refusal = ref<LiveRefusal | null>(null);
  const camera = shallowRef<LiveCamera | null>(null);
  /** Whether the flashlight is on — only ever set from what the camera accepted (`LiveCamera.torch`). */
  const torchOn = ref(false);
  const torchAvailable = computed(() => camera.value?.torch != null);
  const open = options.open ?? openLiveCamera;
  const read = options.read ?? ((pixels: ImageData) => readLicenceBarcode(pixels));
  const score = options.score ?? sharpness;
  const now = options.now ?? (() => performance.now());
  const floor = BUNDLED_DEFAULT_CONFIG.gates.resolutionMinLongEdgePx;
  const nextFrame = options.nextFrame ?? onNextVideoFrame;
  const kind = LIVE_SLOTS[options.slot];

  const history: ScoredFrame[] = [];
  let pressedAt: number | null = null;
  let lastScored = -Infinity;
  let lastRead = -Infinity;
  let reading = false;
  /** Bumped by every start and stop, so a frame callback or a read from an older session does nothing. */
  let session = 0;

  const crop = (cam: LiveCamera): Rect | null => {
    const o = options.outline();
    if (!o) return null;
    const size = cam.size();
    return withMargin(viewRectToVideo(o.rect, o.view, size, mirrored(options.slot)), CROP_MARGIN, size);
  };

  const release = (): void => {
    session += 1;
    camera.value?.stop();
    camera.value = null;
    // A stopped track takes its light with it, so the button must not go on saying it is on.
    torchOn.value = false;
    reading = false;
    pressedAt = null;
    history.length = 0;
  };

  const refuse = (why: LiveRefusal): void => {
    release();
    refusal.value = why;
    state.value = "refused";
  };

  async function take(snap: Snapshot, licence: AamvaLicence | null): Promise<void> {
    state.value = "taking";
    release();
    try {
      options.onCapture({ file: await snap.toFile(), licence });
    } catch {
      refuse("busy");
    }
  }

  function tick(mine: number): void {
    const cam = camera.value;
    if (mine !== session || !cam) return;
    const c = crop(cam);
    const t = now();
    if (c && c.width > 0 && c.height > 0) {
      if (t - lastScored >= SCORE_EVERY_MS) {
        lastScored = t;
        const frame = { at: t, sharpness: score(cam.sample(c, SCORE_LONG_EDGE)) };
        history.push(frame);
        trimHistory(history, t);
        if (pressedAt !== null && settled(history, pressedAt, frame)) {
          void take(cam.snapshot(c), null);
          return;
        }
      }
      if (kind.reads && pressedAt === null && !reading && t - lastRead >= READ_EVERY_MS) {
        lastRead = t;
        reading = true;
        const snap = cam.snapshot(c);
        void read(snap.pixels(READ_LONG_EDGE))
          .then((licence) => {
            if (mine !== session) return;
            reading = false;
            if (licence) void take(snap, licence);
          })
          .catch(() => {
            if (mine === session) reading = false;
          });
      }
    }
    schedule(mine);
  }

  function schedule(mine: number): void {
    const el = video.value;
    if (!el || mine !== session) return;
    nextFrame(el, () => tick(mine));
  }

  async function start(): Promise<void> {
    const el = video.value;
    if (!el) return;
    release();
    const mine = session;
    refusal.value = null;
    state.value = "starting";
    const opened = await open(el, kind.facing);
    if (mine !== session) {
      if (opened.ok) opened.camera.stop();
      return;
    }
    if (!opened.ok) return refuse(opened.refusal);
    camera.value = opened.camera;
    // Measured, never assumed (D-APP11's premise, re-checked 2026-09-30): what the camera GRANTED, cut to the
    // outline, against the gate's own floor — before the driver spends a moment aiming.
    const c = crop(opened.camera);
    if (!c || !meetsResolutionFloor(c, floor)) return refuse("too_low");
    opened.camera.onEnded(() => mine === session && refuse("busy"));
    state.value = "aiming";
    schedule(mine);
  }

  /** The shutter. On the CDL's back it is the way past a barcode too worn to read. */
  function shutter(): void {
    if (state.value !== "aiming") return;
    pressedAt = now();
    state.value = "settling";
  }

  /** The flashlight button. A light the camera refused, or one for a camera already let go, changes nothing. */
  async function toggleTorch(): Promise<void> {
    const cam = camera.value;
    if (!cam?.torch) return;
    const want = !torchOn.value;
    const took = await cam.torch(want);
    if (took && camera.value === cam) torchOn.value = want;
  }

  // A locked phone or a switched app stops the camera under us (iOS always does); coming back starts it again.
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden" && camera.value) release();
    else if (document.visibilityState === "visible" && state.value !== "refused" && state.value !== "taking" && !camera.value) void start();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    onScopeDispose(() => document.removeEventListener("visibilitychange", onVisibility));
  }
  onScopeDispose(release);

  return { state, refusal, start, shutter, stop: release, torchOn, torchAvailable, toggleTorch };
}

/**
 * `requestVideoFrameCallback` runs once per NEW camera frame (Safari 15.4+, Chrome 83+). A repaint-timed
 * callback, the fallback, can score one frame several times — harmless for ranking, which is all it feeds.
 */
function onNextVideoFrame(video: HTMLVideoElement, callback: () => void): void {
  if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => callback());
  else requestAnimationFrame(() => callback());
}
