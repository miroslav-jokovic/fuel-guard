import { browserImageIo } from "@/features/apply/capture/webImageIo";
import { knockOutPaper } from "@/features/apply/signing/markRaster";
import { trimToBlob } from "@/features/apply/signing/markStyles";

/**
 * The third way to make a mark: a picture of a signature the driver already has (C2, DocuSign's
 * Upload tab).
 *
 * ── ⚠ WHY THE FILE IS NEVER STAGED AS IT ARRIVED ──────────────────────────────────────────────
 * Four things are wrong with the bytes a driver hands over, and each one produces a filed packet that
 * looks nothing like what they approved:
 *
 * 1. ⚠ **`renderPacketOverlay` calls `embedPng` and only `embedPng`.** A JPEG — which is what a phone
 *    produces — lands in the `signature_mark` slot, passes the staging contract (`image/jpeg` is an
 *    allowed content type), and is then caught by the overlay's `catch` and silently replaced by the
 *    typed name. Screen shows one thing, paper carries another, no error anywhere. That is the A3
 *    failure exactly, and it would arrive by construction rather than by accident.
 * 2. ⚠ **The paper is opaque.** Every pixel given to `embedPng` is drawn, so a photograph of a
 *    signature is a white rectangle laid over the carrier's own signature line, hiding it. See
 *    `knockOutPaper`.
 * 3. ⚠ **The paper counts as height.** The overlay scales by `DRAWN_MARK_MAX_HEIGHT / image.height`,
 *    so a signature occupying a tenth of an A4 sheet arrives on the line at a tenth of 18pt. See
 *    `inkBounds`.
 * 4. **EXIF.** A photograph taken on a phone carries the coordinates of wherever it was taken.
 *    `browserImageIo.decode` re-encodes through a canvas, which cannot preserve it — the same
 *    property, for the same reason, as the licence-capture path (A7).
 *
 * So the upload is decoded, cleaned, trimmed and re-encoded as a PNG, and the result is what the driver
 * is shown and what is staged. ⚠ **The preview is the staged bytes**, not the file they chose, because
 * a preview of the original would be a preview of something no document will ever contain.
 *
 * ── ⚠ AND FAILURE WITHDRAWS THE PROMISE ───────────────────────────────────────────────────────
 * Everything here returns null rather than throwing, and `usePacketAdoption` turns a null into
 * `drawnMarkFailed` — which is the flag that makes every preview on every later screen fall back to the
 * typed name. A3's rule, stated in its own words: *a stop whose drawing did not stage previews the
 * typed name, because the typed name is what lands.* An upload that cannot be read must behave
 * identically or the screen is lying about a federal record.
 */

/** What the file picker offers. Anything `createImageBitmap` can decode is acceptable here. */
export const UPLOADED_MARK_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

/**
 * Refuse a file this large before decoding it.
 *
 * ⚠ The guard is on the INPUT, not on the PNG that comes out, and the two are different numbers on
 * purpose. `APPLICATION_CAPTURE_MAX_BYTES` (8 MB) is what the staging surface accepts, and the trimmed
 * PNG is always far inside it; this is about a 40-megapixel image being decoded into a phone's memory
 * before anybody discovers the answer is no.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** How big the cleaned picture may be before it is trimmed. Generous — the trim is what sizes it. */
const MAX_DECODE_EDGE = 2000;

export type UploadedMarkFailure = "too_large" | "unreadable" | "blank";

export interface UploadedMark {
  blob: Blob;
  /** For the preview. ⚠ The caller owns revoking it — see `PacketAdoption`'s `drawnUrl` note. */
  width: number;
  height: number;
}

/**
 * Read one file and return the PNG the packet will print, or the reason it cannot.
 *
 * ⚠ **`blank` is a distinct answer and not an error.** A driver who photographs a blank sheet, or whose
 * signature is so faint that `knockOutPaper` removes all of it, has produced a file that decoded
 * perfectly and contains no mark — and *"we could not read that image"* would send them off to fix a
 * camera that is working. The three outcomes need three sentences.
 */
export async function normaliseUploadedMark(
  file: File,
): Promise<UploadedMark | UploadedMarkFailure> {
  if (file.size > MAX_UPLOAD_BYTES) return "too_large";

  let decoded;
  try {
    decoded = await browserImageIo.decode(file);
  } catch {
    // A file that is not an image, a format this browser cannot decode, or a truncated download.
    return "unreadable";
  }

  try {
    const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "unreadable";
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    knockOutPaper(image.data);
    ctx.putImageData(image, 0, 0);

    const blob = await trimToBlob(canvas, ctx);
    if (!blob) return "blank";
    // Read back from the trimmed PNG rather than from the canvas: the preview and the staged bytes must
    // be measured from the same object, or the screen reports a size the packet does not receive.
    const bitmap = await createImageBitmap(blob);
    const mark = { blob, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return mark;
  } catch {
    return "unreadable";
  } finally {
    decoded.close();
  }
}
