import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS } from "@silvicom/shared";

/**
 * The words of the one employer form and the employment timeline (HW5b, HIRING-WORKFLOW-AUDIT §4.5).
 *
 * ── WHY THE APPLICANT'S ENGLISH LIVES HERE ────────────────────────────────────────────────────
 * The form is the applicant's AND the office's, and the office's record screen cannot import
 * `features/apply` (`lint:boundaries`). The questions the office asks across the desk are the ones the
 * application asks on the phone — `AddEmployerForm` said so in 2026-09 and copied them by reference —
 * so the English is written ONCE, here: `strings.history.ts` spreads `EMPLOYMENT_FORM_COPY` into
 * `APPLY_COPY.employment` (where the Spanish twin, `es/strings.es.history.ts`, is held to the same
 * keys by `satisfies Localized<…>`), and `EMPLOYMENT_OFFICE_COPY` is this object with the sentences
 * that address the applicant ("Blank if you work there now") said about them instead.
 *
 * `strings.ts`'s voice governs: state the fact, then the next action; no CFR citation in any string.
 * The (iv) questions are plain words for §391.21(b)(10)(iv)(A) and (B); `EmployerForm.test.ts` holds
 * each against the committed text.
 */
export const EMPLOYMENT_FORM_COPY = {
  employer: "Employer",
  /**
   * ⚠ Says the company name need not be exact. Owner, 2026-09-11: drivers do not remember the exact
   * legal names of carriers they left years ago, and a form that looks like it wants one is a form
   * they stop filling in. The office confirms the name at review.
   */
  employerHint: "The name as you remember it is fine — we will confirm it.",
  usdot: "USDOT number",
  usdotHint: "If you know it.",
  address: "Street address",
  addressHint: "We have to record where we wrote to.",
  city: "City",
  state: "State",
  phone: "Phone",
  phoneHint: "So we can contact them.",
  email: "Email",
  emailHint: "If you know it.",
  position: "Position",
  from: "From",
  to: "Until",
  toHint: "Blank if you work there now.",
  reason: "Reason for leaving",
  reasonHint: "Why you moved on.",
  /**
   * Asked, with "yes" chosen (HW5b, EM-5/EM-10): it decides whether a job from years four to ten
   * belongs on the list at all, and it was a pre-ticked box on one form and an unticked one on another.
   */
  droveTruck: "Did you drive a truck in this job?",
  droveTruckHint: "Any commercial vehicle — a tractor-trailer, a straight truck, a bus.",
  /**
   * EM-10: this decides whether the carrier owes the employer a safety-history inquiry, and it was
   * behind "More about this job (optional)" — the one answer on the panel with a legal consequence,
   * hidden as optional. Asked in the main run now, defaulting to "yes" for the reason `blankEmployer`
   * gives.
   */
  dotQuestion: "Was this employer regulated by the DOT?",
  dotQuestionHint: "A trucking company or any business whose trucks need a USDOT number. Leave Yes if you are not sure.",
  subjectToFmcsr: "In this job, did the Federal Motor Carrier Safety Regulations apply to you?",
  subjectToFmcsrHint: "The federal safety rules for trucking companies and their drivers.",
  safetySensitive: "Was this a safety-sensitive job that required DOT drug and alcohol testing?",
  safetySensitiveHint:
    "Any job the DOT tests for drugs and alcohol, in any industry it regulates — trucking, buses, aviation, rail, transit or pipelines.",
  yes: "Yes",
  no: "No",
  /** What is still behind the disclosure: the three answers nothing on the filing requires. */
  moreAboutJob: "Phone, email and USDOT number (optional)",
  moreAboutJobHint: "Add what you know. We will ask you later if we need the rest.",
  drawerNew: "Add a job",
  drawerIntro: "One job at a time. You can change it later.",
  drawerSave: "Save this job",
  drawerCancel: "Cancel",
  removeJob: "Remove this job",
  /** EM-5: every removal asks first, on every surface. */
  removeTitle: (name: string): string => `Remove ${name}?`,
  removeMessage: "It comes off your list of jobs.",
  removeConfirm: "Remove",
  noName: "A job with no name",

  // ── the timeline (EM-9) ──────────────────────────────────────────────────────────────────────
  timelineHeading: "Your jobs, newest first",
  timelineEmpty: "No jobs yet.",
  jobToNow: "now",
  jobNoDates: "No dates yet",
  editJob: "Change",
  tagTruck: "Drove a truck",
  tagDot: "DOT-regulated",
  jobComplete: "Complete",
  jobMissing: (n: number): string => (n === 1 ? "1 detail missing" : `${n} details missing`),
  unfinished: "Unfinished — finish or remove",
  finish: "Finish",
  /** The two lines the regulation draws, on the timeline where they fall. */
  markThree: (date: string): string => `${EMPLOYMENT_WINDOW_YEARS} years ago · ${date}`,
  markThreeHint: "Every job after this line, driving or not.",
  markTen: (date: string): string => `${CMV_WINDOW_YEARS} years ago · ${date}`,
  markTenHint: "Between the two lines, only the jobs where you drove a truck.",
  cmvBetween: (n: number): string =>
    n === 1 ? "1 driving job between the two lines." : `${n} driving jobs between the two lines.`,
  gapLine: (from: string, to: string, days: number): string => `No job from ${from} to ${to} · ${days} days`,
  explainGap: "Explain this gap",
  gapExplained: "What you were doing:",
  addJobHere: "Add a job here",
};

export type EmploymentFormCopy = { readonly [K in keyof typeof EMPLOYMENT_FORM_COPY]: (typeof EMPLOYMENT_FORM_COPY)[K] extends (
  ...args: infer A
) => string
  ? (...args: A) => string
  : string };

/**
 * The office's version: the same questions, with the sentences that speak TO the applicant spoken
 * ABOUT them. Everything not overridden is the applicant's English, by reference.
 */
export const EMPLOYMENT_OFFICE_COPY: EmploymentFormCopy = {
  ...EMPLOYMENT_FORM_COPY,
  employerHint: "The name as the driver remembers it is fine.",
  toHint: "Blank if they still work there.",
  reasonHint: "Why they left.",
  addressHint: "Where the safety-history inquiry is sent.",
  phoneHint: "For the verification call.",
  usdotHint: "If known.",
  emailHint: "If known.",
  droveTruck: "Did they drive a truck in this job?",
  dotQuestionHint: "A trucking company or any business whose trucks need a USDOT number.",
  subjectToFmcsr: "In this job, did the Federal Motor Carrier Safety Regulations apply to them?",
  moreAboutJob: "Phone, email and USDOT number",
  moreAboutJobHint: "Optional on the application; the phone is what the verification call needs.",
  drawerIntro: "The same questions the applicant answers.",
  removeMessage: "It comes off the list of jobs.",
  timelineHeading: "Jobs, newest first",
  markTenHint: "Between the two lines, only the jobs where they drove a truck.",
  gapExplained: "What they were doing:",
};
