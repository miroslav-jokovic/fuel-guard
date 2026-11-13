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
 * ── STAGE 2 IS `<task>.<question>` ────────────────────────────────────────────────────────────
 * Part 2 is a task list (D-AW11), and a task is what saves there: the draft autosaves as it is typed,
 * and "Save and continue" closes a task on the task's own check (`validateSection`). So a Stage 2 id's
 * prefix is the task's section (`APPLICATION_FILLING_SECTIONS`), and its screens are walked inside the
 * open task (`useTaskWalk`). Each task joins this list with the PR that generates it (F4 PR 1b-1…1b-4,
 * plan §7 2026-11-13); until then its screens are the hand-written section component.
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

  // ── Stage 2, "Your history" (SCREEN-MAP §3) — Part 2's tasks ──
  // "About you" (F4 PR 1b-2): the name typed together (D-AM3), then one question a screen. The carrier's
  // page-1 questions follow, one a screen, from the served definition (`useTaskWalk`, SCREEN-MAP 2.2–2.4).
  "identity.name",
  "identity.other_names",
  "identity.email",
  "identity.ssn",
  // "Your driving record" (2.18–2.21, F4 PR 1b-1). The accident and conviction screens repeat per row.
  "safety.accidents",
  "safety.accident_date",
  "safety.accident_nature",
  "safety.accident_casualties",
  "safety.accident_hazmat",
  "safety.violations",
  "safety.violation_date",
  "safety.violation_offence",
  "safety.violation_state",
  "safety.violation_penalty",
  "safety.denied",
  "safety.denied_detail",
  "safety.suspended",
  "safety.suspended_detail",
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

/**
 * Answers a driver can tap instead of typing (SCREEN-MAP §1, "quick-pick answers where answers
 * repeat"). The box stays: a pick fills it, and anything else is typed.
 *
 * ⚠ The values are the ENGLISH words, because they are what is filed and printed — the packet is the
 * carrier's English paper (Q-AW11), the same reason a licence kind prints as `CDL` whatever language
 * the form was read in (`licenceKindWords`). The button shows each in the page's language
 * (`APPLY_COPY.quickPicks`, typed so every value has its words).
 */
export const QUICK_PICKS = {
  // SCREEN-MAP 2.19b.
  violation_offence: ["Speeding", "Logbook or hours of service", "Equipment", "Lane change or following too closely"],
  // SCREEN-MAP 2.19d. P10: the paper's PENALTY column.
  violation_penalty: ["Fine", "Points", "Suspension", "Bond forfeited"],
  // SCREEN-MAP 2.4, its own list ("other" is the box). The carrier's channels: production held five
  // drafts and no filed application on 2026-11-13, too few answers to choose picks from.
  heard_from: ["Indeed", "Facebook", "A friend or a driver", "Our website"],
} as const;
export type QuickPickList = keyof typeof QUICK_PICKS;

/** One place a fact is asked: its screen, and what that screen needs to know about it there. */
export interface FactAsk {
  readonly screen: WizardScreenId;
  readonly when?: WizardCondition;
  readonly dates?: WizardDates;
  /**
   * This yes/no answers whether a list has rows — "In the last 3 years, were you in any accident?" over
   * `accidents` (SCREEN-MAP §1: "yes/no gates first; loops only on Yes"). The fact stored is the
   * list's "none" declaration (`declares_no_accidents`), so the question is its inverse: No declares
   * none and clears the list, Yes opens the list's first row (`SafetyHistoryFields`' rule since
   * C3c2c1, kept). Unanswered is "not declared none, and no rows".
   */
  readonly gate?: string;
  readonly quickPicks?: QuickPickList;
}
