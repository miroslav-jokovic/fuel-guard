import { z } from "zod";

/**
 * The office's side of an application — reading it, correcting it, approving it (F4).
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────────────────────────
 * Until 2026-09-11 nobody reviewed anything. A driver filled in nine screens, certified, and the
 * document was filed — `application_invitations` carried `consented_at`, `releases_completed_at` and
 * `submitted_at` and nothing between them, and the dashboard had no surface that showed a filed
 * application at all. The owner's words: *"complete application should be reviewable and editable on
 * our side in dashboard and after that when approved and reviewed we should send it back to driver
 * for signing."*
 *
 * ── THE ORDER, AND THE ONE THING THAT DID NOT MOVE (D-AX11) ───────────────────────────────────
 * The four authorizations in `APPLICATION_RELEASE_ORDER` stay at the FRONT. They are what
 * `SCREENING_PREREQUISITES` gates PSP, MVR and previous-employer inquiries on — so behind the review
 * they would mean reviewing blind. Only the §391.21(b)(12) certification moves to the end, because a
 * certification of answers the office has since corrected certifies something else.
 *
 * ── AND WHY AN EDIT IS ADDRESSED BY A CONTRACT PATH ───────────────────────────────────────────
 * `["employers", 0, "city"]` is what the validator reports, what `fieldLabels.ts` turns into
 * "Employer 1 · City", and what `fieldId()` turns into the DOM id of the control. One vocabulary for
 * the error a driver sees, the correction an office makes, and the mark the signing screen puts
 * beside it — rather than three that have to be kept in step.
 */

/** A contract path as the validator produces it: strings for keys, integers for row positions. */
export const applicationPathSchema = z
  .array(z.union([z.string().min(1).max(80), z.number().int().min(0).max(200)]))
  .min(1)
  .max(3);

export type ApplicationPath = z.infer<typeof applicationPathSchema>;

/**
 * One correction.
 *
 * ⚠ `value` is `unknown` and deliberately not narrowed here. The office is editing a field of
 * `driverApplicationSchema`, and which type is legal depends entirely on which path — a boolean at
 * `declares_no_accidents`, a string at `employers.0.city`, an array at `addresses`. Narrowing it in
 * this schema would mean restating the contract; the service applies the edit and re-parses the WHOLE
 * document against `driverApplicationSchema`, which is the only check that can actually be right.
 */
export const applicationEditSchema = z.object({
  path: applicationPathSchema,
  value: z.unknown(),
});

export type ApplicationEdit = z.infer<typeof applicationEditSchema>;

/** What the office reads back about one correction. */
export interface ApplicationEditRecord {
  path: ApplicationPath;
  before: unknown;
  after: unknown;
  editedAt: string;
  /** The person, resolved to a name where we have one — never a bare uuid on a screen. */
  editedBy: string | null;
}

/**
 * Where an application has got to.
 *
 * ⚠ Derived from the phase timestamps rather than stored as a column, for the reason every other
 * state in this product is: a status column and the timestamps that imply it drift, and then two
 * screens disagree about the same row. The timestamps are the facts; this is the reading.
 */
export const APPLICATION_REVIEW_STATES = [
  "filling",
  "awaiting_review",
  "approved",
  "certified",
] as const;

export type ApplicationReviewState = (typeof APPLICATION_REVIEW_STATES)[number];

export const APPLICATION_REVIEW_STATE_LABELS: Record<ApplicationReviewState, string> = {
  filling: "Still filling it in",
  awaiting_review: "Waiting for you",
  approved: "Sent back to sign",
  certified: "Signed and filed",
};

export interface ApplicationPhases {
  reviewRequestedAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
}

/**
 * ⚠ Read in reverse — the LAST thing that happened wins.
 *
 * Reading forwards ("is it filling? is it awaiting review?") answers with the first box ticked and
 * gets every later state wrong, which is the classic shape of this bug. A certified application has
 * all three stamps set and is not "awaiting review".
 */
export function applicationReviewState(phases: ApplicationPhases): ApplicationReviewState {
  if (phases.submittedAt) return "certified";
  if (phases.approvedAt) return "approved";
  if (phases.reviewRequestedAt) return "awaiting_review";
  return "filling";
}

/** May the office still change answers? Only between the driver sending it and the driver signing. */
export const applicationIsEditable = (phases: ApplicationPhases): boolean =>
  applicationReviewState(phases) === "awaiting_review";

/**
 * Where the application has got to, INCLUDING whether anybody has typed anything (F5).
 *
 * ── WHY `applicationReviewState` WAS NOT ENOUGH ───────────────────────────────────────────────
 * ⚠ That function answers "filling" for two situations a recruiter needs to tell apart: a driver who
 * was invited and has not opened the link, and a driver who is on screen six. Nothing staff-facing
 * could tell them apart, because **nothing staff-facing read the draft** — the applicant board
 * computed its stage from `driver_employment_history`, which is written only at submission, and the
 * invitation row read `consented_at`, which is never stamped while the carrier's wording is draft.
 * So an owner who filled in their own test application was told "Not started", twice, on two screens.
 *
 * The draft is the only evidence a driver has begun. One boolean — does a row exist — is the whole of
 * the fix, and it is passed in rather than read here because this package does no I/O.
 */
export const APPLICATION_PROGRESS_STATES = [
  "not_started",
  "filling",
  "awaiting_review",
  "approved",
  "certified",
] as const;

export type ApplicationProgressState = (typeof APPLICATION_PROGRESS_STATES)[number];

export const APPLICATION_PROGRESS_LABELS: Record<ApplicationProgressState, string> = {
  not_started: "Not opened yet",
  filling: "Filling it in",
  awaiting_review: "Waiting for you",
  approved: "Sent back to sign",
  certified: "Signed and filed",
};

/**
 * ⚠ Read in reverse, for the same reason `applicationReviewState` is: the LAST thing that happened
 * wins. A certified application has every earlier stamp set too.
 */
export function applicationProgress(
  phases: ApplicationPhases,
  hasDraft: boolean,
): ApplicationProgressState {
  const state = applicationReviewState(phases);
  if (state !== "filling") return state;
  return hasDraft ? "filling" : "not_started";
}

/**
 * May the driver certify?
 *
 * Approved and not yet certified. ⚠ Not "approved", full stop: `submitted_at` is what makes a second
 * certification impossible, and a predicate that ignored it would re-open the certify screen on a
 * link whose application is already filed.
 */
export const applicationAwaitsSignature = (phases: ApplicationPhases): boolean =>
  applicationReviewState(phases) === "approved";
