import { createHash } from "node:crypto";
import sharp from "sharp";
import { BUNDLED_DEFAULT_CONFIG, computeMetrics, type MeasuredMetrics } from "@silvicom/capture-engine";
import { APPLICATION_CAPTURE_MARK_SLOT, type ApplicationCaptureSlot } from "@silvicom/shared";

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

/** What is stored in `application_captures.metrics` — the measurement and the config that gave it meaning. */
export interface CaptureMetricsRecord extends MeasuredMetrics {
  configVersion: string;
}

export type CaptureVerification =
  | { ok: true; serverSha256: string; bytes: number; metrics: CaptureMetricsRecord | null; cpuMs: number }
  | { ok: false; reason: "hash_mismatch" | "not_an_image"; serverSha256: string };

const MARK_SLOTS: readonly ApplicationCaptureSlot[] = Object.values(APPLICATION_CAPTURE_MARK_SLOT);

export async function verifyCaptureBytes(
  bytes: Buffer,
  claimedSha256: string,
  slot: ApplicationCaptureSlot,
): Promise<CaptureVerification> {
  const started = process.cpuUsage();
  const serverSha256 = createHash("sha256").update(bytes).digest("hex");
  if (serverSha256 !== claimedSha256.toLowerCase()) return { ok: false, reason: "hash_mismatch", serverSha256 };

  const decoded = await sharp(bytes, { failOn: "none" })
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
