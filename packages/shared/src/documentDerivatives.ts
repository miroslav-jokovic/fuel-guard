import type { DocumentContentType, DocumentVariant } from "./complianceContract.js";

/**
 * Derivative specs for compliance documents (DQF execution plan B1).
 *
 * WHY DERIVATIVES EXIST, PRECISELY. `compliance-docs` accepts originals up to 25 MB (0146:118). A
 * fleet table that renders 200 drivers' medical cards from those originals moves gigabytes per page
 * view. The saving here is EGRESS first and storage second: a 40 KB thumb instead of a 25 MB scan is
 * three orders of magnitude, and it is paid for by a few hundred kilobytes of extra stored bytes.
 * The original is never replaced and never purged (D-DQ10) — §390.32(d) requires the record be
 * reproducible, and a lossy WebP of a medical card is not the record.
 *
 * WHY NOT `hazmatExtraction/image.ts`. That normalizer exists to raise a VISION MODEL's read
 * precision: it runs `.normalise()` (luminance stretch) and `.median(1)` (denoise) before handing
 * bytes to Claude. Those are legibility changes to evidence, which is acceptable when the output is
 * an extraction input and unacceptable when the output is what a human — or a DOT auditor — looks at
 * to decide whether a medical card is valid. So this file copies that file's SHAPE (a pinned,
 * fingerprinted, deterministic ruleset) and none of its operations. The only transforms here are
 * EXIF auto-orient, bounded resize, and encode.
 *
 * WHY NOT SUPABASE IMAGE TRANSFORMATIONS (D-DQ11). `createSignedUrl({transform})` would need no code
 * at all. It is Pro-plan-gated and billed per origin image per month; it cannot transform HEIC to
 * anything, and `documents.content_type` admits HEIC; and a URL-side transform is invisible to the
 * data model, whereas `variant='thumb'` is a row that the binder, the retention rules and the
 * storage reconciler can already reason about.
 *
 * PURE ON PURPOSE. No `sharp` import, no I/O — `sharp` is an API-only dependency and this package is
 * consumed by the browser too. The service in `apps/api` applies these numbers; this file decides
 * them, and can be tested without a decoder.
 */

/** Every derivative is WebP: one decoder in every browser we support, and the smallest of the
 *  lossy formats at the qualities below. Never inherits the original's format. */
export const DERIVATIVE_CONTENT_TYPE = "image/webp" as const;

export interface DerivativeSpec {
  /** The `documents.variant` value this produces (0146:63 already constrains the column). */
  variant: Extract<DocumentVariant, "thumb" | "normalized">;
  /** Bound on the LONGER edge. Never upscales — enlarging invents no information. */
  longEdgePx: number;
  /** WebP quality, 1–100. */
  quality: number;
  /** What the derivative is for, so a future reader does not "optimise" the wrong number. */
  purpose: string;
}

/**
 * Two derivatives, two jobs.
 *
 * `thumb` is a table cell. 320 px is 2× a 160 px cell on a retina display; q65 is where WebP stops
 * being visibly worse at that size. It is NOT meant to be readable — it is meant to say "a scan
 * exists and this is roughly what it looks like".
 *
 * `normalized` is the on-screen viewer inside `BaseModal size="xl"` (max-w-4xl ≈ 896 px CSS px, so
 * 2000 px covers a retina panel with room to zoom). q82 keeps the small type on a medical card
 * legible; below ~q75 the DOT examiner's certificate number starts to mush.
 */
export const DERIVATIVE_SPECS: readonly DerivativeSpec[] = [
  {
    variant: "thumb",
    longEdgePx: 320,
    quality: 65,
    purpose: "file-table cell — proves a scan exists; not meant to be read",
  },
  {
    variant: "normalized",
    longEdgePx: 2000,
    quality: 82,
    purpose: "modal viewer — must stay legible down to a certificate number",
  },
] as const;

/**
 * Which uploads can be derived from.
 *
 * PDFs are absent deliberately (D-DQ9): they preview in the browser's own viewer, and rasterising
 * page 1 server-side would mean a rasteriser in the API container for a thumbnail. HEIC is present
 * because `documents.content_type` admits it — whether the deployed `sharp` build actually decodes
 * it is a DEPLOYMENT question (plan step A3), not a policy one, and the service must fail loudly
 * rather than this list quietly lying about intent.
 */
export const DERIVABLE_CONTENT_TYPES: readonly DocumentContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/** True when this upload should get derivatives. PDFs → false, and that is not a gap. */
export function shouldDerive(contentType: DocumentContentType): boolean {
  return DERIVABLE_CONTENT_TYPES.includes(contentType);
}

/** The specs to run for one upload — empty for anything not derivable, so callers can loop blindly. */
export function derivativesFor(contentType: DocumentContentType): readonly DerivativeSpec[] {
  return shouldDerive(contentType) ? DERIVATIVE_SPECS : [];
}

/**
 * A stable fingerprint of the ruleset above.
 *
 * WHY. `IMAGE_NORMALIZER_VERSION` (hazmatExtraction/image.ts:21) carries the same idea and states
 * the reason: when the bytes a pipeline produces change, anything that cached or hashed the old
 * bytes is stale, and a version that someone forgot to bump is worse than no version at all. Here
 * the fingerprint is DERIVED from the specs rather than hand-written, and a test pins its value —
 * so editing a quality or a pixel bound fails the suite until the change is acknowledged
 * deliberately, exactly like the grandfathered-waiver gates elsewhere in this repo.
 */
export function derivativeFingerprint(): string {
  return DERIVATIVE_SPECS.map((s) => `${s.variant}:${s.longEdgePx}:${s.quality}`).join("|");
}

/**
 * The version stamped on a generated derivative.
 *
 * Bump the MAJOR when existing derivatives must be regenerated (a bound or quality changed); the
 * MINOR when a variant is added and old ones stay valid. The pinning test tells you which case you
 * are in by failing.
 */
export const DERIVATIVE_VERSION = "1.0.0";

/**
 * The Storage key for a derivative.
 *
 * Keyed on the DERIVATIVE's own document id, not the original's, because a derivative is its own
 * append-only `documents` row (0146 has no UPDATE policy — a derivative can never be an edit of the
 * original). The `.thumb` / `.normalized` infix is for humans reading a bucket listing; nothing
 * parses it. **The machine-readable link from a derivative back to its original is
 * `documents.derived_from`, added in migration 0206 at plan step B2** — a storage path is not a
 * foreign key, and treating it as one is how the next person ends up regex-matching object names.
 */
export function derivativeStoragePath(
  orgId: string,
  subjectType: string,
  subjectId: string,
  derivativeId: string,
  variant: DerivativeSpec["variant"],
): string {
  return `${orgId}/${subjectType}/${subjectId}/${derivativeId}.${variant}.webp`;
}
