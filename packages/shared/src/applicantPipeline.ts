import { hasLiveAuthorization, type AuthorizationPurpose, type AuthorizationRow } from "./authorizationContract.js";

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
  /** Nothing recorded yet. */
  | "not_started"
  /** Employment declared, but the §391.21(b)(10) window has holes worth asking about. */
  | "history_incomplete"
  /** The history is there; the paperwork that makes a screening lawful is not. */
  | "awaiting_releases"
  /** Everything we can gather without a vendor call is gathered. */
  | "ready_to_screen";

export const APPLICANT_STAGE_LABELS: Record<ApplicantStage, string> = {
  not_started: "Not started",
  history_incomplete: "History incomplete",
  awaiting_releases: "Awaiting releases",
  ready_to_screen: "Ready to screen",
};

/** Stage order, for grouping a board left to right. */
export const APPLICANT_STAGES: readonly ApplicantStage[] = [
  "not_started",
  "history_incomplete",
  "awaiting_releases",
  "ready_to_screen",
];

export interface ApplicantInputs {
  /** Employers declared, at any date. */
  employerCount: number;
  /** Unexplained days inside the §391.21(b)(10) window — Segment A only, never Segment B. */
  gapDays: number;
  authorizations: readonly AuthorizationRow[];
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
  let stage: ApplicantStage;
  if (input.employerCount === 0) stage = "not_started";
  else if (input.gapDays > 0) stage = "history_incomplete";
  else if (!releasesComplete) stage = "awaiting_releases";
  else stage = "ready_to_screen";

  return { stage, outstanding, releasesComplete };
}
