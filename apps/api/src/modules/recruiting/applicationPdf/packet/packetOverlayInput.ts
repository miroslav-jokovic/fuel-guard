import type { PacketFieldOverflow, PlacedFieldValue } from "./packetGrid.js";

/**
 * What `renderPacketOverlay` is asked to draw — the marks, the answers, the overflow, the two
 * pictures and the draft band — and the rules each field carries.
 *
 * ⚠ **Split out of `packetOverlay.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning. Types only, moved unchanged with their comments; `packetOverlay.ts` re-exports
 * both, so every existing import of them still resolves. That file's header — the carrier's PDF is
 * the template, and this is the filing path — is what these fields are read against.
 */

export interface PacketMark {
  /** The placement id from `packetPlacements.ts` — `p03`, `p11a`, `p19b`. */
  placementId: string;
  /** What the driver adopted. The signature of record (D-APP8). */
  signedName: string;
}

export interface PacketOverlayInput {
  marks: readonly PacketMark[];
  /**
   * The applicant's answers, already matched to measured positions by `packetFieldValues.ts`.
   *
   * ⚠ Optional, and empty is a legitimate call: a caller that wants only the marks — the office
   * previewing what the driver has signed so far — asks for only the marks. What is NOT legitimate is
   * FILING one without them, and `renderPacketDocument` is the reason it cannot happen: the filing
   * path goes through it and it always fills them.
   */
  fields?: readonly PlacedFieldValue[];
  /**
   * Answers the carrier's grids had no room for (Q-PKT10).
   *
   * ⚠ Passing them appends a continuation sheet AND draws a notice under each grid that continues.
   * Passing an empty array is "there was no overflow"; NOT passing them at all is "this caller is
   * not filing" — the office previewing the marks. ⚠ `file.ts` must always pass them: §391.21(b)(7)
   * and (b)(8) ask for every accident and conviction in the period, and a filed form missing the
   * fourth is materially false.
   */
  overflow?: readonly PacketFieldOverflow[];
  /** The applicant, so a continuation sheet separated from the packet can be put back with it. */
  applicantName?: string;
  /**
   * The driver's adopted SIGNATURE, as a picture (D-PKT13, D-HUI14).
   *
   * ⚠ PNG bytes, and optional forever. A8b's rule holds here too: a mark that will not render must
   * not stand between a driver and a filed application, so a failure to embed falls back to the typed
   * name rather than throwing.
   *
   * ⚠ **It goes on signature lines and NOWHERE else.** See the mark loop: this was drawn on all
   * twenty-two placements until A3, which is how 141pt of somebody's full autograph ended up in a box
   * the carrier had captioned `Initials`.
   */
  drawnMark?: Buffer | null;
  /**
   * The driver's adopted INITIALS, as a picture (Q-HUI14).
   *
   * ⚠ **A second image rather than a second use of the first, and D-PKT6 is the whole reason.**
   * Initials are *"a SECOND adopted mark and not an abbreviation of the first"* — so this is the
   * separately-typed initials rendered in the face the driver chose, or their own hand drawn or
   * uploaded, and it is never produced by cropping, scaling or abbreviating `drawnMark`. The two
   * arrive in two `application_captures` rows and are read by two calls.
   *
   * ⚠ Optional on the same terms as its sibling: absent means `p05`, `p06` and `p09` print the typed
   * initials from `signed_name`, which is exactly what every packet printed before Q-HUI14 and still
   * the signature of record (D-APP8).
   */
  initialsMark?: Buffer | null;
  /**
   * The words stamped across every sheet, or absent for the FILED document (A2).
   *
   * ⚠ **The filing path never passes this, and that is what keeps A2 off the freeze clock.**
   * `ensureApplicationPdf` renders once and returns those bytes for ever, so a change to how this
   * function prints a FILED packet can only be made before the first one is filed. Adding an option
   * that `renderPacketDocument`'s filing caller does not set changes nothing about what it draws —
   * pinned by "draws no band when the filing path does not ask for one" in `packetOverlay.test.ts`.
   *
   * ⚠ Words rather than a colour, and it is `stamp.ts`'s reasoning carried over to the carrier's
   * paper: D-AVI22 recorded an office reading a red-inked preview as *"the product prints in red"*.
   * A preview whose ink differs from the filing is not previewing the filing, so the answers are
   * drawn in exactly the ink they will be filed in and the sheet says what it is in a sentence.
   */
  band?: string | null;
}
