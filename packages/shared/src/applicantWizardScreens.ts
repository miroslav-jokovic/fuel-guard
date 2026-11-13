/**
 * The wizard's screens, by id (APPLICATION-SCREEN-MAP.md §2–§4 and §7; F4 PR 1).
 *
 * ── WHY THE IDS ARE A LIST AND THE SCREENS ARE NOT ────────────────────────────────────────────
 * §7 has the wizard GENERATED from the fact catalogue: each fact says which screen asks it
 * (`ApplicantFact.ask`), and a screen is the facts that name it, in catalogue order
 * (`applicantWizard.ts`). Nothing else says what a screen holds, so a fact cannot be on the
 * catalogue and missing from the form (D-AM7).
 *
 * The ids themselves are listed because they are a VOCABULARY, not a derivation: the page's copy is
 * keyed by them (`Record<WizardScreenId, …>`, which is what makes a screen without words fail
 * `vue-tsc`), and the order they walk in is the order below. A test holds the list and the
 * catalogue to each other in both directions — an id no fact names, and a fact naming an id not
 * here, both fail.
 *
 * ── THE ID IS `<page>.<question>` ─────────────────────────────────────────────────────────────
 * The page is the unit that SAVES: one of Part 1's pages (`PART_ONE_SCREENS`), each of which posts
 * its answers in one call and is what a returning applicant resumes on. The wizard steps through a
 * page's screens one question at a time (D-AM2) and saves when the page's last one is answered, so
 * the posting rules — §40.25(j) first, the licence list replaced whole (0376) — are unchanged by
 * how many screens the page is cut into.
 *
 * ⚠ Stage 2 (Part 2's history) is not here yet. Its screens join this list with the PR that
 * generates them (F4 PR 1b, the loops), and so do `loop` and `quickPicks`: a field nothing reads
 * would be a promise nothing checks.
 */
export const WIZARD_SCREEN_IDS = [
  // ── Stage 1, "Today" (SCREEN-MAP §2) — Part 1's typed pages ──
  "about.phone",
  "about.date_of_birth",
  "address.home",
  "licence.card",
  "licence.class",
  "licence.expires",
  "licence.endorsements",
  "screening.prior_positive",
  "screening.program_30d",
  "screening.tested_6m",
  "screening.random_12m",
  "screening.donor_gender",
] as const;

export type WizardScreenId = (typeof WIZARD_SCREEN_IDS)[number];

/**
 * Which years a date box assumes for a short answer, and which it refuses (SCREEN-MAP §9) — the
 * same five `AppTypedDate` takes. A property of where the date is ASKED, not of the fact: a
 * licence's expiration is "future" for the CDL in hand and "any" for one given up years ago.
 */
export type WizardDates = "dob" | "past" | "future" | "any" | "month";

/** "Shown only when": the screen is asked when another answer is this value (SCREEN-MAP §1, "IF"). */
export interface WizardCondition {
  readonly fact: string;
  readonly is: boolean | string;
}

/** One place a fact is asked: its screen, and what that screen needs to know about it there. */
export interface FactAsk {
  readonly screen: WizardScreenId;
  readonly when?: WizardCondition;
  readonly dates?: WizardDates;
}
