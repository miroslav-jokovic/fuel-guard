/**
 * Where a signing PLACE is on a served document — one rule for the carrier's packet and the handbook
 * (HANDBOOK-SIGNING-PLAN.md §6.8, D-HB12).
 *
 * ── WHY THE PDF CARRIES IT ────────────────────────────────────────────────────────────────────
 * The permissions already mark their one box with a named destination (`PERMISSION_SIGNATURE_DESTINATION`),
 * so the screen can put a **Sign here** tag on it from the bytes the applicant is looking at, with no
 * second request on a rate-limited link. The packet and the handbook have MANY places, so each gets its
 * own name: `sign:<placementId>`. The walk resolves the one it is standing on, opens that page, and tags
 * that box — the same act on both documents, which is what the owner asked for (2026-09-29).
 *
 * ⚠ **`FitR`, not `XYZ`.** A permission's box is one fixed size and its size lives in a constant beside
 * the name. The packet's lines are twenty different widths measured off the carrier's paper, and the
 * handbook's are its own. `FitR` carries the whole rectangle — left, bottom, right, top, in PDF user
 * space (origin bottom-left) — so the size travels with the place and there is no second constant to
 * drift from the first.
 *
 * ⚠ The handbook is flowed text: which page a place lands on is decided by the renderer, not the paper.
 * That is exactly why it must be written into the document rather than known ahead of it.
 */
export const SIGNING_PLACE_DESTINATION_PREFIX = "sign:";

/** The destination name for one placement id (`p18`, `h4`, …). */
export const signingPlaceDestination = (placementId: string): string =>
  `${SIGNING_PLACE_DESTINATION_PREFIX}${placementId}`;
