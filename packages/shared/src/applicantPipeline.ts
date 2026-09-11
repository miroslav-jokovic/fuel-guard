import { hasLiveAuthorization, type AuthorizationPurpose, type AuthorizationRow } from "./authorizationContract.js";
import { applicationProgress, type ApplicationPhases } from "./applicationReviewContract.js";

/**
 * Where an applicant has got to, and what they are waiting on (HIRING-PLAN.md H6).
 *
 * ── WHY THIS IS A LIST OF OUTSTANDING ITEMS AND NOT A STATUS COLUMN ────────────────────────────
 * A stored stage is a second copy of facts the rows already carry, and it goes stale the moment
 * somebody records an authorization without remembering to advance it. Everything here is DERIVED,
 * so the pipeline cannot disagree with the file it summarises — the same reason the qualification
 * fleet table computes from `employmentCoverage` rather than from a column (D3).
 *
 * ── WHY THE STAGES STOP WHERE THEY DO ──────────────────────────────────────────────────────────
 * The plan sketched invited → applied → releases → screening ordered → decision. Only some of that
 * is derivable from data that exists: there is no invitation record until H5 and no screening ledger
 * until H7. Modelling the missing ones now would be designing against an imagined shape, so the
 * requirement list is the extension point instead — H5 adds `application`, H7 adds `psp_report`, and
 * neither renumbers anything.
 */

/** What an applicant still owes, in the order a recruiter chases them. */
export const APPLICANT_REQUIREMENTS = [
  "employment_history",
  "fcra_disclosure",
  "psp",
  "previous_employer",
] as const;
export type ApplicantRequirement = (typeof APPLICANT_REQUIREMENTS)[number];

export const APPLICANT_REQUIREMENT_LABELS: Record<ApplicantRequirement, string> = {
  employment_history: "Employment history",
  fcra_disclosure: "Background report disclosure",
  psp: "PSP authorization",
  previous_employer: "Previous-employer release",
};

/**
 * The requirements that are AUTHORIZATIONS, mapped to the purpose that satisfies each. Kept as data
 * rather than a switch so a new release is one line here and one line in the list above.
 */
const AUTHORIZATION_REQUIREMENTS: Partial<Record<ApplicantRequirement, AuthorizationPurpose>> = {
  fcra_disclosure: "fcra_disclosure",
  psp: "psp",
  previous_employer: "previous_employer",
};

export type ApplicantStage =
  /** Invited, and the link has not been opened — or no link has been sent. */
  | "not_started"
  /**
   * The driver is part-way through the form (F5).
   *
   * ⚠ Added 2026-09-11 because its absence was a lie on screen. Everything below this line is derived
   * from `driver_employment_history`, which is written **only at submission** — so a driver on screen
   * six of eight was reported as "Not started", and a recruiter chasing them had no way to know they
   * were already typing.
   */
  | "filling_in"
  /** Sent to the office. ⚠ The only stage where the CARRIER owes the next move, not the applicant. */
  | "awaiting_review"
  /** The office approved it and asked for a signature; the driver has not signed yet. */
  | "awaiting_signature"
  /** Employment declared, but the §391.21(b)(10) window has holes worth asking about. */
  | "history_incomplete"
  /** The history is there; the paperwork that makes a screening lawful is not. */
  | "awaiting_releases"
  /** Everything we can gather without a vendor call is gathered. */
  | "ready_to_screen";

export const APPLICANT_STAGE_LABELS: Record<ApplicantStage, string> = {
  not_started: "Not started",
  filling_in: "Filling it in",
  awaiting_review: "Waiting for you",
  awaiting_signature: "Waiting for signature",
  history_incomplete: "History incomplete",
  awaiting_releases: "Awaiting releases",
  ready_to_screen: "Ready to screen",
};

/** Stage order, for grouping a board left to right. */
export const APPLICANT_STAGES: readonly ApplicantStage[] = [
  "not_started",
  "filling_in",
  "awaiting_review",
  "awaiting_signature",
  "history_incomplete",
  "awaiting_releases",
  "ready_to_screen",
];

export interface ApplicantInputs {
  /** Employers declared, at any date. ⚠ Written only at SUBMISSION — see `application` below. */
  employerCount: number;
  /** Unexplained days inside the §391.21(b)(10) window — Segment A only, never Segment B. */
  gapDays: number;
  authorizations: readonly AuthorizationRow[];
  /**
   * The live invitation's phase stamps, if there is one (F5).
   *
   * ⚠ Optional so that every caller predating the application system keeps working unchanged — for
   * a driver with no invitation this is null and the stages behave exactly as they did.
   */
  application?: ApplicationPhases | null;
  /** Has the applicant typed anything? The only evidence that exists before they send it. */
  hasDraft?: boolean;
}

export interface ApplicantProgress {
  stage: ApplicantStage;
  outstanding: ApplicantRequirement[];
  /**
   * True when every release a PSP pull needs is in hand. Named for the question a recruiter asks,
   * and deliberately NOT "may we call PSP" — that answer is the API's, from
   * `missingAuthorizations`, and duplicating the rule here is how two layers come to disagree.
   */
  releasesComplete: boolean;
}

export function applicantProgress(input: ApplicantInputs): ApplicantProgress {
  const outstanding: ApplicantRequirement[] = [];

  if (input.employerCount === 0) outstanding.push("employment_history");
  for (const req of APPLICANT_REQUIREMENTS) {
    const purpose = AUTHORIZATION_REQUIREMENTS[req];
    if (purpose && !hasLiveAuthorization(input.authorizations, purpose)) outstanding.push(req);
  }

  const releasesComplete = !outstanding.some((r) => AUTHORIZATION_REQUIREMENTS[r] !== undefined);

  // The stage is the first thing standing in the way, read in the order a recruiter works. A gap is
  // NOT an outstanding requirement — the applicant answered, the answer just needs a conversation —
  // so it names a stage without ever appearing on the chase list.
  //
  // ⚠ The APPLICATION's own state comes first, and only until it is filed. Before that moment no
  // employment row exists, so the counting below can only ever answer "not started" — which is what
  // it did for every driver mid-form until 2026-09-11. Once the application is certified the stamps
  // stop being the interesting fact and the file itself takes over, which is why `certified` falls
  // through rather than being a stage of its own.
  const filed = input.application
    ? applicationProgress(input.application, input.hasDraft === true)
    : null;

  let stage: ApplicantStage;
  if (filed === "filling") stage = "filling_in";
  else if (filed === "awaiting_review") stage = "awaiting_review";
  else if (filed === "approved") stage = "awaiting_signature";
  else if (input.employerCount === 0) stage = "not_started";
  else if (input.gapDays > 0) stage = "history_incomplete";
  else if (!releasesComplete) stage = "awaiting_releases";
  else stage = "ready_to_screen";

  return { stage, outstanding, releasesComplete };
}
