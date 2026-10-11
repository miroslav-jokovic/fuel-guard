import { z } from "zod";
import { PACKET_MARK_KINDS } from "./packetPlacements.js";

/**
 * The driver adopting a signature or a set of initials, once, for the whole link
 * (APPLICATION-FLOW-V2-PLAN.md D-AW15, C3s1).
 *
 * ── WHAT THE REQUEST CARRIES, AND WHY THE BYTES COME THROUGH THE API ──────────────────────────
 * The kind, the typed text and the picture. The photographs go from the phone straight to Storage
 * (`applicationCaptureContract.ts`), and an adoption does not, for two reasons: 0376 makes
 * `signature_adoptions.sha256` the SERVER's reading of the stored bytes and not the browser's claim,
 * so the server has to hold them anyway; and a mark is a trimmed PNG of a signature, not a
 * twelve-megapixel photograph, so the request is small.
 *
 * ⚠ **The storage key is never in the request.** It is `documentStoragePath(org, 'driver', driverId,
 * id, 'image/png')`, built server-side from an id the server mints, and `record_signature_adoption`
 * refuses any other (SA022). A client that could name the key could name another driver's.
 */

/**
 * The largest adopted mark the server takes, decoded.
 *
 * ⚠ Sized to the largest the page can make, not to a guess: an UPLOADED mark is decoded to at most
 * 2,000 px on its long edge and its paper knocked out to transparent (`markUpload.ts`), which measures in
 * the hundreds of kilobytes for a noisy phone photograph of ink. Three megabytes is that several times
 * over. A drawn or styled mark is tens of kilobytes.
 */
export const SIGNATURE_ADOPTION_MAX_BYTES = 3 * 1024 * 1024;

/** Base64 is 4 characters per 3 bytes; the ceiling on the encoded string follows from the one above. */
const MAX_BASE64_CHARS = Math.ceil(SIGNATURE_ADOPTION_MAX_BYTES / 3) * 4;

export const signatureAdoptionRequestSchema = z.object({
  kind: z.enum(PACKET_MARK_KINDS),
  /**
   * What the driver typed for this mark — the signature of record (D-APP8), which the picture decorates.
   * 1–200 characters after trimming, 0376's own CHECK.
   */
  typed_text: z.string().trim().min(1).max(200),
  /** The PNG, base64 without a `data:` prefix. */
  png_base64: z.string().min(1).max(MAX_BASE64_CHARS),
});
export type SignatureAdoptionRequest = z.infer<typeof signatureAdoptionRequestSchema>;

/**
 * What the link has adopted, as the page is shown it: the typed text of each live adoption, or null.
 *
 * ⚠ **Names, never ids and never pictures.** The link serves capture slots as dates and never as bytes
 * (`listCaptures`), and an adoption is served on the same terms: the page says a picture is saved and
 * shows the typed text. The server finds the live adoption itself when a permission is signed, so the
 * page has no id to send and no way to name another row.
 */
export interface SignatureAdoptionsView {
  signature: string | null;
  initials: string | null;
}
