import {
  APPLICATION_CAPTURE_CONTENT_TYPES,
  type ApplicationCaptureContentType,
  type ApplicationCaptureSlot,
} from "@fuelguard/shared";
import {
  confirmApplicationCapture,
  startApplicationCapture,
  uploadCaptureBytes,
} from "../useApplication";
import { browserImageIo } from "./webImageIo";

/**
 * Putting one blob in one slot (A8).
 *
 * Two callers, one path: the capture screen photographing a licence, and the signing ceremony
 * adopting a drawn mark (A8b). They produce their bytes very differently — a phone camera through
 * the gate, a finger on a canvas — and neither of them should have its own idea of the order these
 * three calls go in, because the order IS the design: nothing is recorded until the bytes are
 * provably in the bucket, so a failed upload leaves no slot claiming to be filled (D-APP10).
 */

/** The three network acts, injectable together so a test can watch the order they happen in. */
export interface CaptureIo {
  start: typeof startApplicationCapture;
  upload: typeof uploadCaptureBytes;
  confirm: typeof confirmApplicationCapture;
  /** sha256 of the bytes, computed in the browser — the API never sees them. */
  digest: (blob: Blob) => Promise<string>;
}

export const DEFAULT_CAPTURE_IO: CaptureIo = {
  start: startApplicationCapture,
  upload: uploadCaptureBytes,
  confirm: confirmApplicationCapture,
  digest: (blob) => browserImageIo.sha256(blob),
};

/**
 * The staging surface accepts three types; a producer may hand us anything.
 *
 * Checked rather than cast: the day a fourth encoder is added to the pipeline this returns null and
 * the caller fails visibly, instead of the server refusing a content type the client swore was fine.
 */
export function captureContentType(mediaType: string | undefined): ApplicationCaptureContentType | null {
  return (APPLICATION_CAPTURE_CONTENT_TYPES as readonly string[]).includes(mediaType ?? "")
    ? (mediaType as ApplicationCaptureContentType)
    : null;
}

/** Thrown when the bytes are a format the staging surface will not take. Never a network problem. */
export class UnsupportedCaptureFormat extends Error {}

export async function stageCapture(
  token: string,
  slot: ApplicationCaptureSlot,
  blob: Blob,
  contentType: ApplicationCaptureContentType,
  io: CaptureIo = DEFAULT_CAPTURE_IO,
): Promise<{ slot: ApplicationCaptureSlot; capturedAt: string }> {
  const sha256 = await io.digest(blob);
  const started = await io.start(token, slot, contentType);
  await io.upload(started.uploadUrl, blob);
  // Last, and only now: the row is what tells the driver the slot is filled.
  return io.confirm(token, started.captureId, { slot, content_type: contentType, sha256 });
}
