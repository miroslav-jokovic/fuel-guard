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
 * ⚠ **Amended 2026-09-19 by D1, which is the first step to discharge part of that seven.** The MVR,
 * the Clearinghouse query and the drug test now have a body that performs the act rather than
 * pointing at the page where it is performed — `"record"` below. Four of the seven remain, and the
 * count above is left as B6 measured it because it is a measurement, not a tally to keep current.
 *
 * ⚠ **Amended 2026-09-18 by Q-HM9, and it moved one row the other way.** The count above is B6's and
 * is left as it measured; what changed is that `employment_investigation` joins the emitted steps
 * with a body that already existed — `EmployerInquirySection`, which B6 had had to park inside the
 * `application` body for want of a step to hang it on. So this is the first step added since B6 that
 * did NOT need a `recorded_act` signpost: the affordance was built long before the row was.
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
  /** `AuthorizationsPanel` — the five releases and the wording version each was signed against. */
  | "authorizations"
  /**
   * `SendApplicationPanel` — AF4's act: send the form, see what screening is still outstanding
   * (D-AF5 warns, never refuses), and get the link back on screen (D-AF7).
   */
  | "send_application"
  /** The §391.21 answers, the history they declare and the §391.23 investigation of that history. */
  | "application"
  /** `PspRecordsSection` — order one, import one bought on the portal, read the filed report. */
  | "psp"
  /**
   * `EmployerInquirySection` — the §391.23(a)(2) investigation: who is owed a letter, what was
   * sent, what came back, and the good-faith attempts that stand in for a reply nobody sent.
   *
   * ⚠ Added by Q-HM9, and it is the one body here that MOVED rather than appeared. It was inside
   * `application` — carried there by B6 because the investigation had no step of its own to hang
   * on, with a comment saying exactly that. Now it does, so it hangs on it. The employment HISTORY
   * stays in `application`, because the §391.21(b)(10) declaration really is the application's
   * content; the investigation OF that history is a separate act with its own evidence.
   */
  | "investigation"
  /** `HireDrawer`'s act: the applicant stops being one. */
  | "hire"
  /**
   * A recorded act with no in-product affordance yet (D-HM6): the medical-registry verification and
   * the road test. The body says what proves it and links the driver's §391.51 file, which is where
   * both are recorded today.
   *
   * ⚠ **D1 took three of the original five** — MVR, Clearinghouse and drug test — and they are
   * `"record"` below. The two that remain each have a named reason rather than a backlog entry: the
   * road test is **D2** and is a §391.31(c) form with an examiner, not an upload; the medical
   * certificate is blocked on **Q-HM11**, because D-HM9 makes the registry verification a gate for
   * every driver and `dqCatalogue` marks it `appliesWhen: "no_cdl"`, and only a reading of
   * §391.51(b)(8) can say which is right.
   */
  | "recorded_act"
  /**
   * A recorded act this product can now RECORD (D1): the MVR, the Clearinghouse query and the drug
   * test. `RecordedActPanel` files the `qualification_records` row that turns the step green —
   * through the recruitment section's own door, because the compliance one gates on `roster`
   * manage and a recruiter does not hold it.
   */
  | "record"
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
  application_sent: "send_application",
  // ⚠ Both land on the application, and that is right rather than lazy: the office's act at step 4
  // IS reading the answers filed at step 3 and approving them, and `ApplicationReviewDrawer` is the
  // surface that does both. Two rows, one document, one place to work.
  application_filled: "application",
  office_approved: "application",
  mvr: "record",
  psp: "psp",
  clearinghouse: "record",
  drug_test: "record",
  medical_certificate: "recorded_act",
  road_test: "recorded_act",
  application_signed: "packet",
  employment_investigation: "investigation",
  hired: "hire",
  // The three with no evidence table. The fold filters them out, so these are unreachable today.
  orientation_videos: "unbuilt",
  live_orientation: "unbuilt",
  handbook: "unbuilt",
};

export const hiringDrawerBody = (key: HiringStepKey): HiringDrawerBody => DRAWERS[key];
