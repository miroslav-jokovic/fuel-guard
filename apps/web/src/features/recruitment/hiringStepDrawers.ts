import type { HiringStepKey } from "@silvicom/shared";

/**
 * What the drawer behind a checklist row contains (B6, `HIRING-UI-PLAN.md` §4.2).
 *
 * ── THE PROBLEM B6 ACTUALLY HAD, WRITTEN DOWN BECAUSE THE PLAN'S SENTENCE IS NOT TRUE ─────────
 * §4.2 says *"the five existing sections become drawer bodies — none is rewritten"*, and that reads
 * as a one-to-one mapping. It is not one. Measured 2026-09-18 against the twelve steps the fold
 * emits: **five have a body that already exists** (the invitation card, the application review
 * drawer for two steps, the PSP section, the hire drawer) and **seven have none**. Six of those
 * seven are what D1, D2 and C1 are for — there is no MVR affordance in this product because
 * `DRIVER-TRAINING-PLAN.md`'s and D1's work is unbuilt, not because B6 forgot it.
 *
 * So the two dishonest readings were available and are both refused here:
 *   - invent a step for each homeless section, which puts rows on a federal checklist that D-HM9
 *     never ruled; or
 *   - give seven rows a drawer that opens onto nothing.
 *
 * What ships instead: the drawer is keyed on the step, every step names its body, and the seven
 * without an in-product affordance get the `recorded_act` or `packet` body — which states the step,
 * its artifact and **the page where the act is performed today**, rather than pretending.
 *
 * ── AND THE FUSE IS THE SAME ONE `hiringArtifacts.ts` USES ────────────────────────────────────
 * ⚠ `Record<HiringStepKey, …>` over a closed union: a step added to `HIRING_STEPS` is a **typecheck
 * failure in this file** until somebody says what its drawer holds. Without that, the next step
 * added gets a blank drawer and nothing fails — which is the delay fuse `CLAUDE.md` names, and the
 * reason B5 made `HiringEvidenceTable` a union in the first place.
 *
 * ⚠ There is no `title` or `description` field here, deliberately. The drawer's title is the step's
 * `label` and its subtitle is the step's `action` — the catalogue already owns both, and `action`
 * is literally the instruction ("Order the driving record"), which is what a drawer exists to carry
 * out. A fourth string per step would be a copy of the catalogue with a delay fuse.
 */
export type HiringDrawerBody =
  /** `ApplicationInviteCard` — the invitation, its state, and the resend/revoke acts. */
  | "invitation"
  /** `AuthorizationsPanel` — the four releases and the wording version each was signed against. */
  | "authorizations"
  /** The §391.21 answers, the history they declare and the §391.23 investigation of that history. */
  | "application"
  /** `PspRecordsSection` — order one, import one bought on the portal, read the filed report. */
  | "psp"
  /** `HireDrawer`'s act: the applicant stops being one. */
  | "hire"
  /**
   * A recorded act with no in-product affordance yet (D-HM6): MVR, Clearinghouse, drug test,
   * medical-registry verification, road test. The body says what proves it and links the driver's
   * §391.51 file, which is where all five are recorded today. **D1 and D2 replace this body.**
   */
  | "recorded_act"
  /**
   * The 22-place signing ceremony. The driver performs it on their own link; the office has no
   * view of it at all until C1 builds one.
   */
  | "packet"
  /**
   * A step this schema cannot prove, so the fold never emits it and no row can open it. Present
   * only because the `Record` is total over `HiringStepKey` — D3 and D4 give these real bodies.
   */
  | "unbuilt";

const DRAWERS: Record<HiringStepKey, HiringDrawerBody> = {
  invitation_sent: "invitation",
  permissions_signed: "authorizations",
  // ⚠ Both land on the application, and that is right rather than lazy: the office's act at step 4
  // IS reading the answers filed at step 3 and approving them, and `ApplicationReviewDrawer` is the
  // surface that does both. Two rows, one document, one place to work.
  application_filled: "application",
  office_approved: "application",
  mvr: "recorded_act",
  psp: "psp",
  clearinghouse: "recorded_act",
  drug_test: "recorded_act",
  medical_certificate: "recorded_act",
  road_test: "recorded_act",
  application_signed: "packet",
  hired: "hire",
  // The three with no evidence table. The fold filters them out, so these are unreachable today.
  orientation_videos: "unbuilt",
  live_orientation: "unbuilt",
  handbook: "unbuilt",
};

export const hiringDrawerBody = (key: HiringStepKey): HiringDrawerBody => DRAWERS[key];
