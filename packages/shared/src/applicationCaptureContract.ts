import { z } from "zod";
import type { DocumentKind } from "./complianceContract.js";

/**
 * The documents an applicant photographs from the application link (A8, D-APP10).
 *
 * ── WHY THERE IS A STAGING VOCABULARY AT ALL, INSTEAD OF `DOCUMENT_KINDS` ──────────────────────
 * `DOCUMENT_KINDS` is the carrier's whole filing vocabulary — every certification kind, every
 * §391.51 record kind, plus `other`. An applicant is not filing a driver qualification file; they are
 * answering "photograph these four things". Handing an unauthenticated caller the carrier's entire
 * vocabulary would let a stranger with a live link deposit an object filed as `hazmat_training` or
 * `operating_authority` into the org's evidence bucket. The slot set below is closed for that reason,
 * and the mapping to `DocumentKind` happens SERVER-SIDE at promotion, from this table, never from a
 * request body.
 *
 * ── AND WHY A SLOT IS NOT A KIND ──────────────────────────────────────────────────────────────
 * `cdl_front` and `cdl_back` are two photographs of ONE document. The slot is what the driver is
 * asked for; the kind is what the qualification file calls the result. Collapsing them would either
 * ask the driver twice for "CDL" with no way to tell the two apart, or file the back of a licence as
 * a second, separate licence.
 */

export const APPLICATION_CAPTURE_SLOTS = [
  "cdl_front",
  "cdl_back",
  "medical_card",
  "ssn_card",
  /**
   * The drawn signature mark (D-APP7/D-APP8). It is written by the signing ceremony rather than by
   * the capture screen, and it is decoration: the signature of record is the typed name stored beside
   * the exact disclosure text on the `driver_authorizations` row. A driver on a cracked screen who
   * cannot produce a squiggle has still signed.
   */
  "signature_mark",
  "other",
] as const;

export type ApplicationCaptureSlot = (typeof APPLICATION_CAPTURE_SLOTS)[number];

/** The machine tokens ship with their labels, as every state vocabulary in this product does. */
export const APPLICATION_CAPTURE_SLOT_LABELS: Record<ApplicationCaptureSlot, string> = {
  cdl_front: "Front of your licence",
  cdl_back: "Back of your licence",
  medical_card: "Medical examiner's certificate",
  ssn_card: "Social Security card",
  signature_mark: "Your signature",
  other: "Anything else",
};

/**
 * What the capture screen asks for, in order.
 *
 * `signature_mark` is deliberately absent — it belongs to the signing ceremony, and a slot on this
 * screen inviting a driver to photograph a signature would collect a photograph of a piece of paper
 * rather than the mark D-APP8 describes. `other` is absent because a form that opens with "anything
 * else" invites a folder of receipts into an evidence bucket; it exists in the vocabulary so a later
 * step can ask for something specific without a migration.
 */
export const APPLICATION_CAPTURE_REQUESTED: readonly ApplicationCaptureSlot[] = [
  "cdl_front",
  "cdl_back",
  "medical_card",
  "ssn_card",
];

/**
 * Which slots the driver must have photographed before they can send the application.
 *
 * Empty, and that is a decision rather than an omission. §391.21 is a form; nothing in it requires a
 * photograph, and §391.51's file is assembled by the carrier over the whole hiring process — the
 * medical certificate is verified against the National Registry, the licence is checked against the
 * MVR. A driver whose phone camera will not open, or who is photographing a licence in the dark at a
 * truck stop, must still be able to certify and send their application; the alternative is losing the
 * candidate over a photograph the recruiter can ask for by email.
 */
export const APPLICATION_CAPTURE_REQUIRED: readonly ApplicationCaptureSlot[] = [];

/**
 * Where a promoted capture lands in the qualification file (D-APP10).
 *
 * `ssn_card` maps to `other` because there is no §391.51 record kind for it — and it is worth saying
 * out loud that this is the one slot whose CONTENT is more sensitive than the column it lands in:
 * D-APP3 seals a typed Social Security number into a secretBox envelope bound to the org, or drops it
 * entirely when no key is configured, while a photograph of the card is nine digits as pixels in an
 * evidence bucket that sealing cannot reach. It is filed because a carrier lawfully collects it and
 * `documents` is restricted at both the row (0146's driver-scoped RESTRICTIVE policy) and the
 * projection; it is named here so the next person weighing a retention rule meets the asymmetry.
 */
export const APPLICATION_CAPTURE_DOCUMENT_KIND: Record<ApplicationCaptureSlot, DocumentKind> = {
  cdl_front: "cdl",
  cdl_back: "cdl",
  medical_card: "medical_card",
  ssn_card: "other",
  signature_mark: "other",
  other: "other",
};

/**
 * The `documents.page` a promoted capture takes.
 *
 * Two sides of one licence are two PAGES of one document, which is exactly what that column has meant
 * since 0146 (a multi-page BOL). Filing the back as page 2 keeps the pair adjacent and ordered
 * wherever documents are listed, instead of two page-1 rows whose order depends on which upload won.
 */
export const APPLICATION_CAPTURE_PAGE: Record<ApplicationCaptureSlot, number> = {
  cdl_front: 1,
  cdl_back: 2,
  medical_card: 1,
  ssn_card: 1,
  signature_mark: 1,
  other: 1,
};

/**
 * The staging bucket, separate from `compliance-docs` on purpose (D-APP10).
 *
 * A candidate who never submits must leave nothing in an evidence bucket. `documents` is
 * `RETENTION_FORBIDDEN` and append-only; three attempts at one blurry licence photograph must not
 * become three rows in a qualification file for somebody who then took another job. So captures land
 * here, replaceable by slot, and only a certified submission copies them across.
 */
export const APPLICATION_CAPTURES_BUCKET = "application-captures";

/**
 * What a phone camera may hand us.
 *
 * A strict subset of `DOCUMENT_CONTENT_TYPES`: the web provider re-encodes every photograph through a
 * canvas to WebP or JPEG (which is what strips EXIF — see `webImageIo.ts`), and PNG is what a
 * signature canvas produces. `image/heic` and `application/pdf` are absent because nothing on this
 * path can produce them, and a content type nothing produces is a content type nothing has tested.
 */
export const APPLICATION_CAPTURE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ApplicationCaptureContentType = (typeof APPLICATION_CAPTURE_CONTENT_TYPES)[number];

/** Storage key extension per content type — the single place this mapping is decided for captures. */
export const APPLICATION_CAPTURE_EXTENSIONS: Record<ApplicationCaptureContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The ceiling on one capture, enforced by the bucket's own `file_size_limit` as well as here.
 *
 * 8 MB is far above what the provider produces — it downscales to the config long edge and encodes at
 * WebP q80, which puts a licence photograph in the low hundreds of kilobytes — and far below what an
 * unauthenticated caller could use a driver's link as free storage for.
 */
export const APPLICATION_CAPTURE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Where the staged bytes live: `{org}/{invitation}/{capture}.{ext}`.
 *
 * Keyed by the INVITATION rather than by the driver, which is the difference between this bucket and
 * `compliance-docs`. A staged object belongs to one session — it is collected when that session's
 * invitation is deleted, and it has no business being addressable by driver until it has been
 * certified and promoted.
 */
export function applicationCaptureStoragePath(
  orgId: string,
  invitationId: string,
  captureId: string,
  contentType: ApplicationCaptureContentType,
): string {
  return `${orgId}/${invitationId}/${captureId}.${APPLICATION_CAPTURE_EXTENSIONS[contentType]}`;
}

/**
 * `POST /:token/capture` — ask for somewhere to put one photograph.
 *
 * It mints a signed upload URL and writes NOTHING. The row is written by the confirm call below, once
 * the bytes are provably in the bucket, and the asymmetry is deliberate: a browser whose upload fails
 * leaves an object nobody registered (swept by the nightly orphan reconcile after its 24-hour grace),
 * never a row claiming a photograph that was never taken.
 */
export const applicationCaptureStartSchema = z.object({
  slot: z.enum(APPLICATION_CAPTURE_SLOTS),
  content_type: z.enum(APPLICATION_CAPTURE_CONTENT_TYPES),
});
export type ApplicationCaptureStart = z.infer<typeof applicationCaptureStartSchema>;

/**
 * `PUT /:token/capture/:id` — the bytes landed; stage the row.
 *
 * The sha256 is the client's claim about bytes the API never sees, exactly as it is for every
 * document registered through `compliance.ts` since 0146. `bytes` and `content_type` are NOT taken
 * from the request: the confirm reads them back from Storage, so what the row records about the
 * object is what the object actually is.
 */
export const applicationCaptureConfirmSchema = z.object({
  slot: z.enum(APPLICATION_CAPTURE_SLOTS),
  /**
   * The type the start call minted the key for. It is what lets the API RECOMPUTE the storage key
   * from the org and the invitation the token resolved to rather than accepting a path from the
   * request — a caller can name a type, and cannot name a prefix outside their own session.
   */
  content_type: z.enum(APPLICATION_CAPTURE_CONTENT_TYPES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "A sha256 is 64 hexadecimal characters"),
});
export type ApplicationCaptureConfirm = z.infer<typeof applicationCaptureConfirmSchema>;

/** What `GET /:token` tells the page about a slot it has already collected. */
export interface ApplicationCaptureView {
  slot: ApplicationCaptureSlot;
  contentType: string;
  bytes: number | null;
  capturedAt: string;
}
