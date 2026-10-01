import {
  evaluateGate,
  unavailableOcr,
  type CaptureConfig,
  type CaptureMode,
  type CaptureProvider,
  type CapturedPage,
  type ImageMetrics,
  type ImageRef,
  type ScanResult,
  type SupportResult,
} from "@silvicom/capture-engine";
import { browserImageIo, pickPhotoFromCamera, type WebImageIo } from "./webImageIo";

/**
 * The web capture provider (A7, D-APP11) — the applicant's own phone, from the application link.
 *
 * `@silvicom/capture-engine` is pure and zero-dependency with an explicit provider seam, and its own
 * header says implementations live where the IO lives. This is that: the third implementation, beside
 * the native Expo module and the driver app's JS fallback, and it mirrors the fallback deliberately —
 * camera → downscale to the config long edge → WebP q80 (JPEG where the browser cannot) → EXIF gone.
 *
 * ── THE POINT OF THE GATE IS THAT IT RUNS BEFORE THE NETWORK ──────────────────────────────────
 * A driver photographing a licence in a truck-stop car park is on a connection they are paying for
 * and waiting on. Uploading a photograph that will be rejected costs them twice: once for the bytes,
 * and again for the round trip that tells them to take it anyway. So `scan()` returns
 * `{ ok: false, reason }` and there is no page to upload — the flow prompts a re-shoot and nothing
 * has crossed the wire.
 *
 * ⚠ Resolution is measured on the ORIGINAL, before the downscale. Gating the downscaled copy would be
 * circular: everything would pass, because everything is resized to the same long edge.
 *
 * ── WHAT IT DOES NOT MEASURE, AND WHY THAT IS SAID OUT LOUD ───────────────────────────────────
 * Blur, glare, coverage, contrast: all `na`. The arithmetic is no longer the obstacle — `computeMetrics`
 * is shared with the server since D-SCAN8, and the server now records it on every capture (D-AW9,
 * `captureVerification.ts`). The obstacle is that every floor it would be compared against is `null`
 * until thresholds come from recorded samples (D-SCAN10), so a browser number would be read by nothing:
 * APPLICATION-FLOW-V2-PLAN.md Q-AW32 holds the advisory until they do. §5's rule stands meanwhile — an
 * unmeasured check is `na` and never a silent pass.
 */

/**
 * A photograph and how it was made. A picker that returns a bare `File` made it through a file input
 * (`web_file_input`); the live scanner says `web_live_camera`, so a page never claims the wrong provenance.
 */
export interface PickedPhoto {
  file: File;
  captureMode: CaptureMode;
}

export interface WebCaptureOptions {
  io?: WebImageIo;
  pick?: () => Promise<File | PickedPhoto | null>;
}

export const WEB_PROVIDER_ID = "capture.web.file_input";
export const WEB_PROVIDER_VERSION = "0.1.0";

/** A processed photograph: the page the engine describes, and the encoded bytes its `uri` points at. */
export interface ProcessedPhoto {
  page: CapturedPage;
  bytes: Blob;
}

/**
 * The web provider, plus the one thing only it can do: turn its own handle back into bytes.
 *
 * ── WHY THE BYTES ARE HANDED OVER, AND NEVER READ BACK FROM THE URL ───────────────────────────
 * `ImageRef.uri` is, in the engine's words, "an opaque handle the owning provider understands". Here it
 * is an object URL, and the obvious way to get the bytes out again — `fetch(uri)` — is a CONNECTION as
 * far as the browser is concerned, governed by `connect-src`. Production's CSP (`appHttp.ts`) does not
 * list `blob:` there, and should not need to: so `fetch("blob:…")` fails with a bare "Failed to fetch",
 * which the capture screen could only report as a lost signal. That was every applicant photograph in
 * production from the day the scanner shipped until 2026-09-30 — zero rows in `application_captures`,
 * zero objects in its bucket — and no test saw it, because `vite preview` sends no CSP and the unit
 * tests stubbed `fetch`. So the bytes leave the provider as bytes, once, and the URL is only ever an
 * `<img src>` (which `img-src blob:` does allow).
 */
export interface WebCaptureProvider extends CaptureProvider {
  /**
   * The encoded bytes behind a page this provider returned, handed over ONCE: the entry is dropped as it
   * is read, so a phone does not keep a second copy of every photograph alive. Null for a handle this
   * provider never issued, or one already taken.
   */
  takeBytes(uri: string): Blob | null;
}

export async function processPhoto(
  file: File,
  config: CaptureConfig,
  io: WebImageIo,
  captureMode: CaptureMode = "web_file_input",
): Promise<ProcessedPhoto> {
  const decoded = await io.decode(file);
  try {
    // Measured before anything is resized — see the header.
    const originalLongEdge = Math.max(decoded.width, decoded.height);
    const profile = config.enhance.modelFacing;
    const encoded = await io.encode(decoded, profile.longEdgePx, profile.format, profile.quality);
    const integrityHash = await io.sha256(encoded.blob);

    const image: ImageRef = {
      // An object URL, not a file path: the bytes live in the page until the upload step takes them.
      uri: URL.createObjectURL(encoded.blob),
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.blob.size,
      mediaType: encoded.mediaType,
    };

    const metrics: ImageMetrics = { longEdgePx: originalLongEdge };
    const ocr = unavailableOcr("web.none");
    const quality = evaluateGate({ metrics, ocr, platform: "web" }, config);

    const page: CapturedPage = {
      originalOfRecord: image,
      perspectiveCorrected: image,
      enhancedColor: image,
      enhancedGray: image,
      quality,
      // Thin, and honestly so: the browser measures the pre-downscale long edge and nothing else, so
      // every other metric is absent and the gate reads them as `na`. Carried anyway — a page's
      // measured inputs belong with it wherever it was taken (Step 5.1).
      metrics,
      ocr,
      metadata: {
        providerId: WEB_PROVIDER_ID,
        providerVersion: WEB_PROVIDER_VERSION,
        configVersion: config.configVersion,
        device: "web",
      },
      integrityHash,
      // A file input (the camera app, a picked file) or the live scanner — never Expo (§6.6.7).
      provenance: { captureMode, osEnhanced: false },
    };
    return { page, bytes: encoded.blob };
  } finally {
    decoded.close();
  }
}

export function createWebFileProvider(
  config: CaptureConfig,
  options: WebCaptureOptions = {},
): WebCaptureProvider {
  const io = options.io ?? browserImageIo;
  const pick = options.pick ?? pickPhotoFromCamera;
  /** Bytes of accepted pages not yet taken, by their object URL. Rejected pages never enter it. */
  const issued = new Map<string, Blob>();

  return {
    id: WEB_PROVIDER_ID,
    version: WEB_PROVIDER_VERSION,

    async isSupported(): Promise<SupportResult> {
      // A file input exists in every browser that can render this page; there is no permission to
      // ask for in advance, because the picker asks when it opens. No document scanner, no OCR.
      const supported = typeof document !== "undefined" && typeof createImageBitmap === "function";
      return { supported, camera: supported, docScanner: false, ocr: false };
    },

    async scan(): Promise<ScanResult> {
      let picked: File | PickedPhoto | null;
      try {
        picked = await pick();
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }
      if (!picked) return { ok: false, reason: "CAPTURE_CANCELLED" };
      const { file, captureMode } = picked instanceof File ? { file: picked, captureMode: "web_file_input" as const } : picked;

      let page: CapturedPage;
      let bytes: Blob;
      try {
        ({ page, bytes } = await processPhoto(file, config, io, captureMode));
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }

      if (!page.quality.passed) {
        // Nothing to upload. The object URL is released here rather than left for the browser to
        // collect: a driver re-shooting four times should not accumulate four rejected photographs
        // in memory on a phone.
        URL.revokeObjectURL(page.originalOfRecord.uri);
        return {
          ok: false,
          reason: page.quality.reasons[0] ?? "PROVIDER_ERROR",
          message: page.quality.reasons.join(", "),
        };
      }
      issued.set(page.originalOfRecord.uri, bytes);
      return { ok: true, pages: [page] };
    },

    takeBytes(uri: string): Blob | null {
      const bytes = issued.get(uri) ?? null;
      issued.delete(uri);
      return bytes;
    },

    cancel(): void {
      /* single-shot capture — the picker owns its own dismissal */
    },
  };
}
