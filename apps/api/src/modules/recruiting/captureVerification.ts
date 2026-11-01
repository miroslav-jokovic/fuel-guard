import { createHash } from "node:crypto";
import sharp from "sharp";
import { BUNDLED_DEFAULT_CONFIG, computeMetrics, type MeasuredMetrics } from "@silvicom/capture-engine";
import { APPLICATION_CAPTURE_MARK_SLOT, type ApplicationCaptureContentType, type ApplicationCaptureSlot } from "@silvicom/shared";

/**
 * The server's half of a capture (APPLICATION-FLOW-V2-PLAN.md §6.6.3, D-AW9, AW4, C3b2a): the object
 * read back, hashed, decoded and measured — before any row says the slot is filled.
 *
 * ── WHY THE SERVER HASHES WHAT THE BROWSER ALREADY HASHED ─────────────────────────────────────
 * `application_captures.sha256` has always been the BROWSER's claim about the bytes it sent. Nothing
 * checked it, so a truncated PUT, a proxy that re-encoded the image, or a client that lied all produced a
 * row describing bytes that were not the ones in the bucket. `server_sha256` is the server's own reading
 * of the object; the two must agree, and when they do not, nothing is staged (`capture_not_intact`).
 *
 * ── WHY IT DECODES, AND WHAT THE METRICS ARE FOR ──────────────────────────────────────────────
 * A photograph that will not decode is not a photograph, whatever its content type says, and a
 * recruiter would find that out at the worst moment. The metrics are `computeMetrics` — the ONE
 * implementation the driver app, the hazmat gate and this share (D-SCAN8) — at the capture config's
 * analysis scale, and they are **advisory**: every blur/glare/shadow floor in the bundled config is
 * `null` until thresholds come from recorded samples (D-SCAN10). These rows ARE those samples.
 *
 * ⚠ Decoded at full resolution and downscaled in `computeMetrics`, never by sharp — `hazmatExtraction/
 * image.ts`'s header says why (sharp's resampler manufactured 10% glare on a page whose brightest pixel
 * was 235).
 *
 * ⚠ The drawn marks (signature, initials) are hashed and decoded but not measured: a finger on a canvas
 * has no focus or glare, and a number for it would read as data about a photograph.
 *
 * Cost, measured 2026-09-27 before this was built (plan §12): 34.7 ms of CPU for a web upload, 78.9 ms for
 * an unprocessed 12 MP JPEG — inline in the request. Each verification logs its own CPU time so the
 * figure on the service's vCPU can be read from its logs (`[capture-verify]`).
 */

export const CAPTURE_METRICS_ANALYSIS_LONG_EDGE_PX = BUNDLED_DEFAULT_CONFIG.analysis.longEdgePx;

/**
 * The most pixels one capture may decode to (2026-10-20 audit, M2).
 *
 * ⚠ The 8 MB bucket ceiling bounds the FILE, not the picture: a 16,000 × 16,000 single-colour PNG
 * is a few hundred kilobytes on the wire and a gigabyte once `.raw()` has it — and sharp's own
 * default ceiling (`limitInputPixels`, ~268 million) is above that. Decoded inline in the request
 * on the API's one vCPU, at the intake's twenty a minute, that is the whole process gone for a
 * live-link holder with a PNG encoder. Thirty-six million is a 6,000 × 6,000 frame: three times
 * the provider's own output and above any CDL or medical-card photograph a phone hands this path
 * (the provider downscales to the config long edge; an unprocessed 12 MP JPEG was the largest
 * measured, plan §12), so an honest capture never meets it. Read from the header BEFORE decoding,
 * and handed to sharp as well in case a header lies.
 */
export const CAPTURE_MAX_PIXELS = 36_000_000;

/** What is stored in `application_captures.metrics` — the measurement and the config that gave it meaning. */
export interface CaptureMetricsRecord extends MeasuredMetrics {
  configVersion: string;
}

export type CaptureVerification =
  | { ok: true; serverSha256: string; bytes: number; metrics: CaptureMetricsRecord | null; cpuMs: number }
  | { ok: false; reason: "hash_mismatch" | "not_an_image" | "not_a_pdf" | "too_many_pixels"; serverSha256: string };

/**
 * A PDF's own signature (ISO 32000-1 §7.5.2): `%PDF-` within the first 1,024 bytes. §9 P9 sends a PDF
 * as the driver holds it, so the server cannot decode it as a picture — it checks the bytes are the
 * ones sent (the hash) and that they are a PDF at all, and measures nothing: a scan has no camera.
 */
const PDF_MAGIC = Buffer.from("%PDF-");
export const looksLikePdf = (bytes: Buffer): boolean => bytes.subarray(0, 1024).includes(PDF_MAGIC);

const MARK_SLOTS: readonly ApplicationCaptureSlot[] = Object.values(APPLICATION_CAPTURE_MARK_SLOT);

export async function verifyCaptureBytes(
  bytes: Buffer,
  claimedSha256: string,
  slot: ApplicationCaptureSlot,
  /** The type the key was minted for (§9 P9): a PDF is checked as a PDF, everything else decoded. */
  contentType: ApplicationCaptureContentType,
  /** A parameter for the test that proves the ceiling without encoding a 36-megapixel picture. */
  maxPixels: number = CAPTURE_MAX_PIXELS,
): Promise<CaptureVerification> {
  const started = process.cpuUsage();
  const serverSha256 = createHash("sha256").update(bytes).digest("hex");
  if (serverSha256 !== claimedSha256.toLowerCase()) return { ok: false, reason: "hash_mismatch", serverSha256 };
  if (contentType === "application/pdf") {
    if (!looksLikePdf(bytes)) return { ok: false, reason: "not_a_pdf", serverSha256 };
    const used = process.cpuUsage(started);
    return { ok: true, serverSha256, bytes: bytes.byteLength, metrics: null, cpuMs: (used.user + used.system) / 1000 };
  }

  // The header first: width and height without decoding a pixel. A picture that will not even give
  // those is not a picture; one that is bigger than the ceiling is refused before it costs memory.
  const header = await sharp(bytes, { failOn: "none" }).metadata().catch(() => null);
  if (!header || !header.width || !header.height) return { ok: false, reason: "not_an_image", serverSha256 };
  if (header.width * header.height > maxPixels) return { ok: false, reason: "too_many_pixels", serverSha256 };

  const decoded = await sharp(bytes, { failOn: "none", limitInputPixels: maxPixels })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!decoded) return { ok: false, reason: "not_an_image", serverSha256 };
  const { data, info } = decoded;
  const metrics = MARK_SLOTS.includes(slot)
    ? null
    : {
        ...computeMetrics(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          info.width,
          info.height,
          CAPTURE_METRICS_ANALYSIS_LONG_EDGE_PX,
          info.channels,
        ),
        configVersion: BUNDLED_DEFAULT_CONFIG.configVersion,
      };
  const used = process.cpuUsage(started);
  return { ok: true, serverSha256, bytes: bytes.byteLength, metrics, cpuMs: (used.user + used.system) / 1000 };
}
