/**
 * The "Your documents" screen's words (A8; HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P9).
 *
 * ── WHY ITS OWN FILE ──────────────────────────────────────────────────────────────────────────
 * `strings.ts` stood at 476 of the 500-line budget and P9 adds the list's new controls. One screen's
 * copy, spread into `APPLY_COPY` as `strings.handbook.ts` is, so `strings.test.ts` still walks it.
 */
export const APPLY_DOCUMENTS_COPY = {
  /**
   * A8. The screen asks for photographs of documents a driver is carrying, which is a moment where
   * the house rule — state the fact, then the next action — earns its keep twice: once for why the
   * carrier wants them, and once for what to do when a photograph is refused. A rejection that says
   * only "that did not work" sends a driver to a support call; one that names the problem sends them
   * to a window.
   */
  documents: {
    /**
     * §9 P9 (HIRING-WORKFLOW-AUDIT §4.7): the copy stops inviting the skip. Until P9 it ended "— or skip
     * them and send them to the carrier later", and the audit measured what that bought: the owner saw
     * "only the CDL". Every paper is still optional; the sentence now asks for what the driver has.
     */
    intro: "Send what you have now — you can bring the rest to the office.",
    optional: "Each one can be a photo or a PDF. None of them stop you sending the application.",
    /** The licence's two sides, taken in Part 1 beside the number (AF3) and never asked for again. */
    fromLicenceStep: "Received with your licence",
    upload: "Upload a file",
    uploadAgain: "Choose another file",
    addAnother: "Add another",
    /** A second training certificate is "Training certificate 2", so the list says which is which. */
    numbered: (label: string, n: number): string => `${label} ${n}`,
    pdfDone: "PDF received",
    /** `APPLICATION_CAPTURE_MAX_BYTES`, said in the driver's units. */
    tooLarge: "That file is larger than 8 MB. Send a smaller copy, or bring it to the office.",
    take: "Take photo",
    retake: "Take it again",
    working: "One moment…",
    done: "Received",
    failedHeading: "That photo did not go through",
    failed: "Check your signal and take it again. Nothing was lost.",
    /** D-AW9: the server re-hashed the object and it was not the photo sent (422 `capture_not_intact`). */
    notIntact: "That photo did not arrive intact. Take it again.",
    /**
     * Why a photograph was refused, in the driver's words rather than the gate's. Total over the
     * rejection taxonomy on purpose: a reason with no sentence would reach a driver as a blank.
     */
    rejected: {
      DOCUMENT_NOT_DETECTED: "No document in the picture. Lay it flat and fill the frame.",
      IMAGE_BLURRED: "Too blurry to read. Hold still and try again.",
      GLARE_OVER_TEXT: "There is glare across the text. Move away from the light.",
      SHADOW_OVER_TEXT: "A shadow is covering the text. Move so your hand is not over it.",
      RESOLUTION_TOO_LOW: "Too small to read. Take it closer so the document fills the frame, or choose a larger picture.",
      LENS_DIRTY: "The lens looks smudged. Wipe it and try again.",
      PAGE_INCOMPLETE: "Part of the document is out of frame. Fit all four corners in.",
      LOW_CONTRAST: "Too washed out to read. Try somewhere with more light.",
      UNDER_OR_OVER_EXPOSED: "Too dark or too bright. Try somewhere with even light.",
      TEXT_ILLEGIBLE: "The text cannot be read. Move closer and try again.",
      OCR_UNAVAILABLE: "Could not check the photo on this phone. Try again.",
      SCANNER_MODULE_UNAVAILABLE: "Could not open the camera. Try again.",
      UNSUPPORTED_DEVICE: "This phone cannot take the photo here. You can send it to the carrier instead.",
      CAPTURE_CANCELLED: "No photo taken.",
      // True for every source (2026-10-07): it said "the camera" until then, but a file the browser cannot
      // open — a HEIC in Chrome, a damaged PDF — lands here too, from "Upload" with no camera involved.
      PROVIDER_ERROR: "We could not open that picture. Take a new photo, or choose a different file.",
    },
  },
} as const;
