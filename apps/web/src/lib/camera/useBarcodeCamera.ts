import { computed, onScopeDispose, ref, shallowRef, type Ref } from "vue";
import type { ReaderOptions } from "zxing-wasm/reader";
import { viewRectToVideo, type LiveFacing, type LiveRefusal, type Rect, type Size } from "./cameraFrame";
import { onNextVideoFrame, openLiveCamera, type LiveCamera, type OpenResult } from "./liveCamera";

/**
 * A camera that reads barcodes and hands each one over as text — the shop's camera fallback (M9c,
 * MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.6; the owner, 2026-10-29: "finish everything related to
 * tablets first").
 *
 * ── WHAT IT IS FOR ────────────────────────────────────────────────────────────────────────────
 * The shop's Tera Pro is a keyboard: it types a barcode and presses Enter, and the sticker field and the Scan
 * page already know what to do with that. This is for when the handheld is not near. A tablet cannot scan its
 * own back, so in practice the camera is a phone's or another tablet's, aimed at the sticker. Every text it
 * reads goes to the SAME function a handheld read goes to (`onRead`), so a camera read and a trigger pull land
 * identically — there is no second set of rules about what a barcode means.
 *
 * ── HOW IT DIFFERS FROM `/apply`'s SCANNER ────────────────────────────────────────────────────
 * `/apply`'s `useLiveScan` takes ONE photograph and keeps it. This keeps nothing: no frame leaves the page,
 * nothing is uploaded, and there is no shutter. It reads the strip under the aiming box a few times a second,
 * one read at a time, and passes on each text it has not passed on before in this opening — a sticker carries
 * three barcodes and a person sweeps across them, so `once: false` (the sticker field) keeps reading until the
 * person closes it, and `once: true` (the Scan page, where one code is one lookup) stops after the first.
 * The same barcode under the box for two seconds is ten identical reads; only the first goes out.
 *
 * ── THE DECODER LOADS WHEN THE CAMERA OPENS, NOT BEFORE ───────────────────────────────────────
 * `lib/barcode/barcodeReader.ts` is ~930 KiB of WebAssembly, reached only through `load`'s dynamic `import()`:
 * a page that never opens the camera never downloads it. A decoder that will not load (offline, no
 * WebAssembly) is its own refusal, `no_reader`, because the advice — use the handheld, or type the code — is
 * not the camera's.
 */

export type BarcodeCameraState = "starting" | "reading" | "refused" | "done";
export type BarcodeCameraRefusal = LiveRefusal | "no_reader";
export type BarcodeReader = (pixels: ImageData, options: ReaderOptions) => Promise<string[]>;

export interface BarcodeCameraOptions {
  /** The formats and tries, from the caller — the decoder is shared, what a screen reads is not. */
  reader: ReaderOptions;
  onRead: (text: string) => void;
  /** Stop after the first read (the Scan page); otherwise read until closed (the sticker field). */
  once?: boolean;
  /** The aiming box on screen and the box the video is drawn in, both in CSS pixels; null reads the whole frame. */
  aim: () => { rect: Rect; view: Size } | null;
  open?: (video: HTMLVideoElement, facing: LiveFacing) => Promise<OpenResult>;
  load?: () => Promise<BarcodeReader>;
  now?: () => number;
  /** Run `callback` on the video's next frame; a test drives the frames itself. */
  nextFrame?: (video: HTMLVideoElement, callback: () => void) => void;
}

/** How often a frame is read, at most — and one read at a time, however long a read takes. */
export const READ_EVERY_MS = 200;
/**
 * The long edge a read is made at. An IMEI's Code 128 is ~90 modules across a ~35 mm sticker; at 1600 px over
 * the aiming strip that is several pixels a module from arm's length, which zxing reads.
 */
const READ_LONG_EDGE = 1600;

const loadReader = async (): Promise<BarcodeReader> => (await import("@/lib/barcode/barcodeReader")).readBarcodeTexts;

export function useBarcodeCamera(video: Ref<HTMLVideoElement | null>, options: BarcodeCameraOptions) {
  const state = ref<BarcodeCameraState>("starting");
  const refusal = ref<BarcodeCameraRefusal | null>(null);
  const camera = shallowRef<LiveCamera | null>(null);
  /** How many distinct barcodes this opening has passed on — the overlay's "that worked". */
  const reads = ref(0);
  const torchOn = ref(false);
  const torchAvailable = computed(() => camera.value?.torch != null);
  const open = options.open ?? openLiveCamera;
  const load = options.load ?? loadReader;
  const now = options.now ?? (() => performance.now());
  const nextFrame = options.nextFrame ?? onNextVideoFrame;

  let reader: BarcodeReader | null = null;
  let lastRead = -Infinity;
  let reading = false;
  /** What this opening has already passed on. Cleared by `start`, so reopening reads a code again. */
  const seen = new Set<string>();
  /** Bumped by every start and stop, so a frame callback or a read from an older session does nothing. */
  let session = 0;

  const crop = (cam: LiveCamera): Rect => {
    const size = cam.size();
    const a = options.aim();
    return a ? viewRectToVideo(a.rect, a.view, size) : { x: 0, y: 0, width: size.width, height: size.height };
  };

  const release = (): void => {
    session += 1;
    camera.value?.stop();
    camera.value = null;
    torchOn.value = false;
    reading = false;
  };

  const refuse = (why: BarcodeCameraRefusal): void => {
    release();
    refusal.value = why;
    state.value = "refused";
  };

  function pass(texts: string[]): void {
    for (const raw of texts) {
      const text = raw.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      reads.value += 1;
      options.onRead(text);
      if (options.once) {
        release();
        state.value = "done";
        return;
      }
    }
  }

  function tick(mine: number): void {
    const cam = camera.value;
    if (mine !== session || !cam || !reader) return;
    const t = now();
    const c = crop(cam);
    if (c.width > 0 && c.height > 0 && !reading && t - lastRead >= READ_EVERY_MS) {
      lastRead = t;
      reading = true;
      void reader(cam.sample(c, READ_LONG_EDGE), options.reader)
        .then((texts) => {
          if (mine !== session) return;
          reading = false;
          pass(texts);
        })
        .catch(() => {
          if (mine === session) reading = false;
        });
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
    seen.clear();
    reads.value = 0;
    // The decoder and the camera are asked for together: the WASM download overlaps the permission prompt.
    const [loaded, opened] = await Promise.all([load().then((r) => r, () => null), open(el, "environment")]);
    if (mine !== session) {
      if (opened.ok) opened.camera.stop();
      return;
    }
    if (!opened.ok) return refuse(opened.refusal);
    if (!loaded) {
      opened.camera.stop();
      return refuse("no_reader");
    }
    reader = loaded;
    camera.value = opened.camera;
    opened.camera.onEnded(() => mine === session && refuse("busy"));
    state.value = "reading";
    schedule(mine);
  }

  /** The flashlight — a dark corner of the bay. A light the camera refused changes nothing. */
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
    else if (document.visibilityState === "visible" && state.value === "reading" && !camera.value) void start();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    onScopeDispose(() => document.removeEventListener("visibilitychange", onVisibility));
  }
  onScopeDispose(release);

  return { state, refusal, reads, start, stop: release, torchOn, torchAvailable, toggleTorch };
}
