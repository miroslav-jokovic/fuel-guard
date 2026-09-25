/**
 * Where a permission's signature goes, as the rendered PDF and the signing screen both need it (AF6).
 *
 * ── WHY A NAMED DESTINATION AND NOT A POSITION ────────────────────────────────────────────────
 * D-AF2 has each permission signed as its own PDF, DocuSign-style: the document on screen, a
 * **Sign here** tag over the box the signature goes in. The box is not at a fixed place. FMCSA's PSP
 * form prints its two NOTICE paragraphs BELOW the signature, and every instrument's text is a
 * different length, so the box lands on whichever page and height the text leaves it. The renderer
 * therefore marks where it drew the box, inside the PDF, as a named destination: standard, invisible
 * metadata that a PDF viewer uses to "go to" a place. `pdfjs` on the signing screen resolves it with
 * `getDestination` and `getPageIndex`. So the position comes from the bytes the applicant is looking
 * at, and needs no second request on a link held to 20 a minute (A0b).
 *
 * ⚠ **A destination carries a point and not a size**, so the size is this constant, read by the
 * renderer that draws the box and by the screen that draws the tag over it. Two copies of 250 × 48
 * would put the tag beside the box the first time somebody widened one.
 */

/** The destination's name. The point is the box's top-left, in PDF user space (origin bottom-left). */
export const PERMISSION_SIGNATURE_DESTINATION = "sign-here";

/** The signature box, in PDF points. */
export const PERMISSION_SIGNATURE_BOX = { width: 250, height: 48 } as const;
