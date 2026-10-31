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
 * The authorizations in `APPLICATION_RELEASE_ORDER` (five since D-AF4) stay at the FRONT. They are what
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
/**
 * §9 P5 (HIRING-WORKFLOW-AUDIT-2026-10-31): every office write names the draft `revision` it read.
 * The applicant's phone autosaves through the same revision check (0376, DA041), and the office's
 * write used to be a bare update outside it — a recruiter typing a job while the phone saved could
 * overwrite the phone. Now a stale revision is refused, on both sides, the same way.
 */
const draftRevision = z.number().int().min(0);

/**
 * The four things the office does to a draft (§4.5): change one answer, remove a job, add a job, and
 * explain a gap. Employer rows are named by their `key`, never by position (Q-AX7) — see
 * `applicationReviewEdits.ts`. `op` is optional on `set` so the one-answer write keeps its shape.
 */
export const applicationEditSchema = z.union([
  z.object({
    op: z.literal("set").optional(),
    path: applicationPathSchema,
    value: z.unknown(),
    revision: draftRevision,
  }),
  z.object({ op: z.literal("remove_employer"), key: z.string().min(1).max(80), revision: draftRevision }),
  z.object({
    op: z.literal("add_employer"),
    // Checked as a whole by the draft schema once it is in the list, like every other edit.
    employer: z.record(z.string(), z.unknown()),
    revision: draftRevision,
  }),
  z.object({
    op: z.literal("explain_gap"),
    gap: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      explanation: z.string().trim().min(1, "Say what they were doing in this time").max(500),
    }),
    revision: draftRevision,
  }),
]);

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
  approved: "Approved, to sign in the office",
  certified: "Signed and filed",
};

export interface ApplicationPhases {
  /**
   * When the office sent the application form, after the permissions (AF4, D-AF5, 0365). Null until
   * then — the link carries the permissions only. ⚠ Required rather than optional so every place that
   * builds phases has to say, and a forgotten one cannot read as "sent".
   */
  applicationSentAt: string | null;
  reviewRequestedAt: string | null;
  approvedAt: string | null;
  /**
   * When the office opened packet signing, in person (AF5, D-AF3, 0369). Approval no longer opens
   * it: `record_packet_mark` refuses DR036 until this is set. ⚠ Required for the reason
   * `applicationSentAt` is — a builder that forgot it would read as "never opened", and say so to
   * the office on every approved application.
   */
  signingOpenedAt: string | null;
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

/**
 * May the office still change answers? From the moment the office SENDS the form until it is filed
 * (§9 P5, Q-WF5 — closing EM-1 and EM-4).
 *
 * ⚠ Until 2026-10-31 this was "awaiting review" only: nothing before the applicant pressed Send, and
 * nothing after approval. The owner's office works the other way — a recruiter on the phone types the
 * jobs the driver cannot remember, before and after approval — and the driver certifies what is on the
 * screen on the day they sign (§391.21(b)(12)), with every office change shown to them first
 * (`applicantVisibleEdits`). Two things keep that honest: the revision check (the phone and the office
 * cannot overwrite each other) and the service's refusal once the driver has made the first mark on
 * the packet — from then on they are signing a document, and it does not move underneath them.
 * `reviewRequestedAt` also opens it, for a link sent before the office's send existed (0365).
 */
export const applicationIsEditable = (phases: ApplicationPhases): boolean =>
  Boolean(phases.applicationSentAt || phases.reviewRequestedAt) && !phases.submittedAt;

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
  approved: "Approved, to sign in the office",
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
  // ⚠ AF4: a draft is "filling" only once the form has been SENT. AF3's identity step writes a draft
  // on the permissions visit, before there is any form to fill — and an office told "filling it in"
  // about somebody it has not yet sent the application to would wait for them instead of screening.
  return hasDraft && phases.applicationSentAt ? "filling" : "not_started";
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
