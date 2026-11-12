/**
 * Every sentence a shared rule says to an APPLICANT, by key (APPLICATION-FIX-PLAN §4 U7, F4).
 *
 * ── WHY KEYS ──────────────────────────────────────────────────────────────────────────────────
 * The cross-field rules, the filing rules, composition and two schema refinements are shared: the API
 * runs them at filing, and the applicant's page runs the same functions so the two cannot disagree (A3).
 * Until U7 each returned an English sentence, and the page passed a rule's sentence through untouched
 * (`messageFor`'s `custom` branch). So the Spanish page read "Say why you left this job" and every
 * F2c and page-21 refusal in English. Now each issue also carries `issueKey` and `params`, and the
 * page renders the key in its own language (`APPLY_COPY.ruleIssues`, whose Spanish twin is checked key for
 * key by `satisfies`). `message` stays: it is what the API's refusal and the office read, in English.
 *
 * These English sentences ARE the page's English (`strings.issues.ts` spreads this object, never a copy),
 * so a sentence changed here changes on the page and in the API together.
 *
 * Params are display strings (`formatDisplayDate` and the like), already in the one date order both
 * languages use (Q-AM12), so a translation reorders them and never re-formats them.
 *
 * US spelling ("license", "expiration"), as the driver reads it (Q-AM6).
 */
export const APPLICANT_ISSUE_TEXT = {
  // ── the cross-field rules (`applicationRules.ts`) ──
  accidents_listed: () => "List every accident in the last 3 years, or confirm there were none",
  violations_listed: () => "List every violation in the last 3 years, or confirm there were none",
  employers_listed: () => "List your employers, or confirm you have not been employed",
  experience_given: () => "Describe your driving experience, or list the equipment you have driven",
  denial_described: () => "Describe the denial",
  suspension_described: () => "Describe the suspension or revocation",
  question_answered: (p: { question: string }) => `Answer the question "${p.question}"`,
  // ── each job (`applicationEmployerContract.ts`, `applicationV2FilingIssues`) ──
  job_drove_truck: () => "Say whether you drove a truck in this job",
  job_dot_regulated: () => "Say whether this employer was regulated by the DOT",
  job_ends_before_start: () => "The end date cannot be before the start date",
  job_saved_again: () => "Open this employer and save it again",
  job_address: () => "Give this employer's street, city and state",
  job_reason_for_leaving: () => "Say why you left this job",
  job_fmcsr: () => "Say whether the Federal Motor Carrier Safety Regulations applied to you in this job",
  job_drug_testing: () => "Say whether this job was subject to DOT drug and alcohol testing",
  // ── the years covered (`applicationV2FilingIssues`) ──
  address_gap_month: (p: { month: string }) => `Tell us where you lived in ${p.month}`,
  address_gap: (p: { from: string; to: string }) => `Tell us where you lived from ${p.from} to ${p.to}`,
  employment_gap: (p: { from: string; to: string }) => `Tell us what you were doing from ${p.from} to ${p.to}`,
  // ── the carrier's paper (`applicationPaperFilingIssues`, `applicationLegacyFilingIssues`) ──
  prior_test_answered: () =>
    "Say whether, in the last two years, you tested positive or refused a test for a driving job you applied for",
  suspension_answered: () => "Say whether a license, permit or privilege of yours has ever been suspended or revoked",
  violation_state: () => "Give the state where it happened",
  violation_penalty: () => "Give the penalty — a fine, points, a suspension",
  // ── page 21 (`sevenDayStatementIssues`) ──
  seven_day_hours: () => "Give your hours on duty for each of the last seven days — 0 for a day you did not work",
  last_relieved_at: () => "Give the date and time you were last off duty",
  // ── Part 1's licenses, composed at filing (`composeFiledApplication`) ──
  license_expiration: (p: { state: string }) => `Give the expiration date of your ${p.state} license`,
  // ── a date of birth (`dateOfBirthProblem`, `rosterContract.ts`) ──
  birth_date_not_real: () => "That is not a real date",
  birth_date_future: () => "Date of birth cannot be in the future",
  birth_date_under_18: () => "A driver must be at least 18 years old",
  birth_date_over_120: () => "Check the year — that date of birth is over 120 years ago",
} as const;

export type ApplicantIssueKey = keyof typeof APPLICANT_ISSUE_TEXT;
export type ApplicantIssueParams<K extends ApplicantIssueKey> = Parameters<(typeof APPLICANT_ISSUE_TEXT)[K]>[0];

/** What a keyed issue adds to any issue shape: the key, its params, and the English sentence. */
export interface ApplicantIssueText {
  message: string;
  issueKey: ApplicantIssueKey;
  params?: Readonly<Record<string, string>>;
}

/**
 * One issue's words: the English `message` and the key the page renders instead. Typed so a key that
 * takes params cannot be called without them.
 */
export function applicantIssue<K extends ApplicantIssueKey>(
  key: K,
  ...params: ApplicantIssueParams<K> extends undefined ? [] : [ApplicantIssueParams<K>]
): ApplicantIssueText {
  const text = APPLICANT_ISSUE_TEXT[key] as (p?: unknown) => string;
  const given = params[0] as Record<string, string> | undefined;
  return { message: text(given), issueKey: key, ...(given ? { params: given } : {}) };
}

export const isApplicantIssueKey = (v: unknown): v is ApplicantIssueKey =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(APPLICANT_ISSUE_TEXT, v);

/**
 * The key a Zod issue carries, if a shared refinement gave it one (`params: { issueKey }`). Zod keeps a
 * custom issue's `params`, so the key survives `safeParse` to the page.
 */
export function issueKeyOf(issue: object): { issueKey: ApplicantIssueKey; params?: Record<string, string> } | null {
  const p = (issue as { params?: unknown }).params as { issueKey?: unknown } | undefined;
  if (!p || !isApplicantIssueKey(p.issueKey)) return null;
  const { issueKey, ...rest } = p as { issueKey: ApplicantIssueKey } & Record<string, string>;
  return Object.keys(rest).length > 0 ? { issueKey, params: rest } : { issueKey };
}
