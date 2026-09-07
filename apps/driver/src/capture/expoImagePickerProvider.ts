import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
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

/**
 * JS fallback provider (DCE §3) — runs BEFORE the native module is built and on unsupported/de-Googled
 * devices. Camera → downscale to the config long edge → WebP q80 (JPEG fallback, F-WebP/O8) → EXIF
 * stripped. It measures only what the JS layer reliably can (resolution, enforced BEFORE upload); blur /
 * glare / OCR are left `na` and the server usabilityGate is the authoritative backstop for those.
 */

/** Lowercase hex, matching what `digestStringAsync` returned and what the native providers emit. */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function processAsset(
  asset: ImagePicker.ImagePickerAsset,
  config: CaptureConfig,
  platform: "ios" | "android",
): Promise<CapturedPage> {
  const originalLongEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
  const targetLong = config.enhance.modelFacing.longEdgePx;

  const ctx = ImageManipulator.manipulate(asset.uri);
  if (originalLongEdge > targetLong) {
    if ((asset.width ?? 0) >= (asset.height ?? 0)) ctx.resize({ width: targetLong });
    else ctx.resize({ height: targetLong });
  }
  const rendered = await ctx.renderAsync();

  const compress = config.enhance.modelFacing.quality / 100;
  const wantWebp = config.enhance.modelFacing.format === "webp";
  let out: Awaited<ReturnType<typeof rendered.saveAsync>>;
  let mediaType: ImageRef["mediaType"];
  try {
    out = await rendered.saveAsync({ format: wantWebp ? SaveFormat.WEBP : SaveFormat.JPEG, compress });
    mediaType = wantWebp ? "image/webp" : "image/jpeg";
  } catch {
    // Some encoders fail WebP → JPEG at the same quality; the server normalizer re-encodes to the
    // canonical WebP regardless, so the evidentiary record stays consistent.
    out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
    mediaType = "image/jpeg";
  }

  /**
   * ── THE HASH IS OVER THE BYTES, WHICH IT WAS NOT ──────────────────────────────────────────────
   * This used to ask `saveAsync` for `base64: true` and digest THE BASE64 STRING. The native provider
   * digests the file's bytes. Same contract field, `integrityHash`, two incompatible values — and
   * nothing anywhere recomputed either, so the integrity claim was decorative rather than checkable.
   * The server verifies it as of this step, which turns the discrepancy from cosmetic into a
   * rejected run, so it has to be the same quantity on every provider. The browser provider was
   * already correct (`crypto.subtle.digest` over the blob), and is untouched.
   *
   * Dropping `base64: true` also removes the round trip the audit flagged: it materialised the whole
   * image as a JavaScript string on the JS thread at about 1.33x its byte size, purely so it could be
   * hashed. Reading the file back gives the real byte count too, in place of the `length * 3 / 4`
   * estimate that stood in for it.
   */
  const file = new File(out.uri);
  const bytes = await file.arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const integrityHash = toHex(digest);
  const image: ImageRef = { uri: out.uri, width: out.width, height: out.height, bytes: bytes.byteLength, mediaType };

  // Resolution is gated on the PRE-downscale capture so a sub-1200px shot is rejected before upload.
  const metrics: ImageMetrics = { longEdgePx: originalLongEdge };
  const ocr = unavailableOcr("expo.none");
  const quality = evaluateGate({ metrics, ocr, platform }, config);

  return {
    originalOfRecord: image,
    perspectiveCorrected: image,
    enhancedColor: image,
    enhancedGray: image,
    quality,
    ocr,
    metadata: { providerId: "capture.js.expo_image_picker", providerVersion: "0.1.0", configVersion: config.configVersion, device: platform },
    integrityHash,
    provenance: { captureMode: "expo_camera", osEnhanced: false },
  };
}

export function createExpoImagePickerProvider(config: CaptureConfig): CaptureProvider {
  const platform: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
  return {
    id: "capture.js.expo_image_picker",
    version: "0.1.0",
    async isSupported(): Promise<SupportResult> {
      const cam = await ImagePicker.getCameraPermissionsAsync();
      return { supported: cam.granted || cam.canAskAgain, camera: cam.granted || cam.canAskAgain, docScanner: false, ocr: false };
    },
    async scan(): Promise<ScanResult> {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: "UNSUPPORTED_DEVICE", message: "Camera permission denied" };
      let picked: ImagePicker.ImagePickerResult;
      try {
        picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset) return { ok: false, reason: "CAPTURE_CANCELLED" };
      try {
        const page = await processAsset(asset, config, platform);
        return { ok: true, pages: [page] };
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }
    },
    cancel(): void {
      /* single-shot capture — nothing to cancel between shots */
    },
  };
}
