import {
  evaluateGate,
  unavailableOcr,
  type CaptureConfig,
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
 * Blur, glare, coverage, contrast: all `na`. The browser could compute a Laplacian variance on a
 * canvas, but a number computed differently from the server's would be a second opinion about the
 * same photograph, and §5's rule is that an unmeasured check is `na` and never a silent pass. The
 * server's usability gate stays the authoritative backstop for everything this cannot see.
 */

export interface WebCaptureOptions {
  io?: WebImageIo;
  pick?: () => Promise<File | null>;
}

export const WEB_PROVIDER_ID = "capture.web.file_input";
export const WEB_PROVIDER_VERSION = "0.1.0";

export async function processPhoto(
  file: File,
  config: CaptureConfig,
  io: WebImageIo,
): Promise<CapturedPage> {
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

    return {
      originalOfRecord: image,
      perspectiveCorrected: image,
      enhancedColor: image,
      enhancedGray: image,
      quality,
      ocr,
      metadata: {
        providerId: WEB_PROVIDER_ID,
        providerVersion: WEB_PROVIDER_VERSION,
        configVersion: config.configVersion,
        device: "web",
      },
      integrityHash,
      provenance: { captureMode: "expo_camera", osEnhanced: false },
    };
  } finally {
    decoded.close();
  }
}

export function createWebFileProvider(
  config: CaptureConfig,
  options: WebCaptureOptions = {},
): CaptureProvider {
  const io = options.io ?? browserImageIo;
  const pick = options.pick ?? pickPhotoFromCamera;

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
      let file: File | null;
      try {
        file = await pick();
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }
      if (!file) return { ok: false, reason: "CAPTURE_CANCELLED" };

      let page: CapturedPage;
      try {
        page = await processPhoto(file, config, io);
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
      return { ok: true, pages: [page] };
    },

    cancel(): void {
      /* single-shot capture — the picker owns its own dismissal */
    },
  };
}
