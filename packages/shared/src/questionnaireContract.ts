import type { ApplicationSection } from "./applicationSections.js";

/**
 * The carrier's own questions, versioned and kept OUT of the regulated contract (A9, D-APP12).
 *
 * ── WHY THIS IS A SEPARATE FILE AND NOT SIX MORE FIELDS ───────────────────────────────────────
 * `driverApplicationSchema` is `.strict()` and numbered to §391.21(b)(1)–(11) so a reader with the
 * CFR open can check it line by line. "How did you hear about this company?" is not in the CFR. Every
 * carrier-specific question added to that schema makes it harder to answer the only question that
 * matters about it — does this collect what the regulation requires? — and a carrier that changes its
 * form should not be changing a regulated schema to do it.
 *
 * So the questions live here, versioned exactly like `DISCLOSURES` and for the same reason: what a
 * person answered is meaningful only beside the exact question they were asked. A definition is
 * immutable once answers exist against it; changing a question means a new version.
 *
 * ── AND WHY THE ANSWERS ARE PROJECTED NOWHERE ─────────────────────────────────────────────────
 * ⚠ D-APP12: they stay in `driver_applications.payload`. They do not reach `drivers`, they do not
 * reach `driver_employment_history`, and they create no DQF item. A test pins each of those. They
 * ARE rendered into the application PDF, because that document is a derivative of the payload and is
 * the only place a recruiter ever sees what the driver wrote — collecting answers nobody can read
 * would be a write-only feature.
 *
 * ── THE ONE RESERVED KEY ──────────────────────────────────────────────────────────────────────
 * `eeo`. Voluntary self-identification must never be visible to the person deciding the hire, so it
 * is stored under its own key and excluded from the rendered document and from every projection.
 * Silvicom defines no EEO questions (§6: absent an instruction, none are defined) — the key is
 * reserved and the exclusion is tested, so the day one is added the exclusion already exists.
 */

/**
 * ⚠ `table` is not in A9's enumerated list of kinds, and it had to be.
 *
 * The plan's types are all scalar — `text | longtext | boolean | select | date | number`. Three of
 * the four things the owner's packet actually asks for are grids: driving experience by class of
 * equipment, education, and three personal references. Flattening the experience grid alone would
 * have produced sixteen scalar fields whose names encode their row and column, which is a table
 * pretending not to be one and is unreadable in the rendered document. One more kind models what the
 * paper is.
 */
export const QUESTION_KINDS = [
  "text",
  "longtext",
  "boolean",
  "select",
  "date",
  "number",
  "table",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** A table's columns are scalar; a table inside a table is a form nobody fills in on a phone. */
export type ColumnKind = Exclude<QuestionKind, "table" | "longtext">;

/**
 * One answer a `select` stores under a key rather than under the words the applicant read.
 *
 * ⚠ **Only where the answer DECIDES something** (Q-HM14). Every other `select` stores the option's
 * own words, because it is displayed beside its question and never matched on — and options may be
 * reworded between versions. An answer that chooses what the packet prints and which lines the
 * applicant signs is matched on by code, so its stored value is a key that cannot be reworded, and
 * the label is what a person sees.
 */
export interface QuestionChoice {
  value: string;
  label: string;
}

export interface QuestionColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  /** Required for `select`, meaningless otherwise. */
  options?: readonly string[];
}

export interface QuestionnaireQuestion {
  id: string;
  label: string;
  kind: QuestionKind;
  /**
   * The wizard screen this question is asked on. Defaults to `questions` (APPLY-EXPERIENCE-PLAN
   * D-AX7).
   *
   * ── WHY A CARRIER'S QUESTION GETS TO SAY THIS ─────────────────────────────────────────────
   * Because the carrier's own paper already says it, and the paper is the authority. `APPLICATION.xlsx`
   * puts five of these nine on **page 1**, beside the name and the address: the position applied for,
   * how the applicant heard about the company, whether they can legally work in the USA, whether they
   * have proof of age, and whether previous employers may be contacted. The other four — education,
   * military service, other training and three references — are on **page 16**, at the back.
   *
   * Our wizard asked all nine on one screen two-thirds of the way through, so "what job are you
   * applying for?" was the sixth of nine steps, after the two heaviest screens in the form.
   *
   * ⚠ **This moves WHERE a question is asked and never WHAT is asked.** The transcription rule at the
   * top of this file is unchanged: spelling is corrected, substance is counsel's. A question's `id`,
   * `label`, `kind` and the answer it produces are untouched by this field, and the answers still
   * travel in one `questionnaire_answers` blob owned by the `questions` section — which is why
   * `APPLICATION_SECTION_KEYS` needs no change and `sectionsCoverTheContract` is unaffected.
   */
  screen?: ApplicationSection;
  /** Shown under the field. Where the packet explains itself, the explanation comes across. */
  hint?: string;
  /** Required for `select`, unless it has `choices`. */
  options?: readonly string[];
  /** A `select` whose answer is a key (`QuestionChoice`). Narrowed by the schema, unlike `options`. */
  choices?: readonly QuestionChoice[];
  /** Required for `table`. */
  columns?: readonly QuestionColumn[];
  /** `table` only — how many rows the driver is asked for. The packet asks for three references. */
  maxRows?: number;
  /**
   * The carrier requires an answer (Q-WF3, owner 2026-10-31; HIRING-WORKFLOW-AUDIT §9 P8, AF-1).
   * Enforced by `APPLICATION_CROSS_FIELD_RULES`, never by a screen alone — see the paragraph below.
   */
  required?: true;
  /**
   * An optional question's stored way of saying "I am not answering this" (§9 P8, §4.4) — so a skip and
   * an unanswered box and a "no" are three different facts on the office's screen and on the packet.
   *
   * ⚠ The `value` is the carrier's English words and is what is STORED, the way every un-keyed answer
   * here stores its own words (`QuestionChoice`'s header): the office's correction list, the filed PDF
   * and page 16 of the packet then print it as written with no lookup, and a translation overlays the
   * `label` only, so a Spanish applicant files the English words. Only on a question without
   * `required` — a required question's schema refuses it.
   */
  skip?: QuestionChoice;
  /**
   * Asked only when another question has this answer (AF-6: "If so, when?" after a "yes" to military
   * service). Data, like the rest, so the screen still knows no question by name.
   */
  askedWhen?: { question: string; is: boolean };
}

/**
 * ⚠ `required` IS A FLAG NOW, AND ONLY BECAUSE IT IS ENFORCED IN BOTH VALIDATORS AT ONCE (§9 P8).
 *
 * This paragraph used to explain why there was no flag: one enforced by the wizard screen alone breaks
 * the property A3 built the wizard on (the client validates with the SERVER'S OWN object), and one
 * enforced nowhere is decoration that reads as a rule. Both still hold. What changed is that the
 * owner decided (Q-WF3, 2026-10-31) that seven of these answers are worth refusing a send for — the
 * audit measured applications arriving with the carrier's questions all blank, because nothing asked.
 *
 * So the flag is read in exactly one place: `APPLICATION_CROSS_FIELD_RULES` (`applicationRules.ts`)
 * builds one rule per required question, and those rules land in `driverApplicationSchema` — the
 * object both the applicant's page and the API's submit route parse with. The screen marks the box
 * and the review lists what is missing from the same flag, so no copy of the list exists anywhere.
 *
 * ⚠ The rule reads the flag off the definition the answers were GIVEN against (`questionnaire_version`),
 * not the one served today: an application answered against v2 — where nothing was required — is not
 * refused at its certification for a rule its applicant was never shown.
 */

export interface QuestionnaireDefinition {
  id: string;
  /** Bumped whenever a question's wording or set changes. Stored on every answered application. */
  version: string;
  title: string;
  intro: string;
  questions: readonly QuestionnaireQuestion[];
}

/** Answers under this key are never rendered and never projected. See the header. */
export const EEO_ANSWER_KEY = "eeo";

/**
 * Silvicom's questions, transcribed from `APPLICATION.xlsx` 2026-08-21 (plan §6.1, pile 2).
 *
 * ⚠ THE TRANSCRIPTION FIXES SPELLING AND NEVER MEANING. The packet reads "reisdency", "benfit",
 * "maritial", "FORFEITTURES"; those are typing, and they are corrected. What is NOT corrected is any
 * question's substance, scope or implication — several of these strings sit on a document somebody
 * signs, and changing what one asks is counsel's to do and not an engineer's.
 *
 * ⚠ THE DRIVING-EXPERIENCE GRID IS NOT HERE, AND IT WAS. A9 first transcribed it as a carrier
 * question, because the owner's packet is where it was found. Checked against the primary sources
 * afterwards, it is the regulation's: §391.21(b)(6) requires "the type of equipment ... which he/she
 * has operated", and FMCSA's own sample application lays that out as exactly this grid. It now lives
 * in `driverApplicationSchema` as `equipment_experience`, where a (b)(6) answer belongs — a regulated
 * answer sitting in a blob D-APP12 projects nowhere is not what §391.51 wants to find.
 *
 * ⚠ WHAT IS DELIBERATELY ABSENT. The packet's other three piles are not questions:
 *   · pile 1 is the §391.21(b) application, which `driverApplicationSchema` already collects;
 *   · pile 3 is the instruments the carrier has drafted, which is A0's material, not A9's;
 *   · pile 4 is policy — the fine schedule, the fuel policy, minimum qualifications, the §391.27
 *     annual certification, the §395.8(j)(2) seven-day statement. A driver ACKNOWLEDGES those; they
 *     are not questions with answers, and several belong to other steps entirely.
 */
export const SILVICOM_DRIVER_V1: QuestionnaireDefinition = {
  id: "silvicom_driver",
  version: "v1",
  title: "A few questions from the carrier",
  intro:
    "These are Silvicom's own questions. They are not part of the federal application you have just "
    + "filled in, and your answers here are kept with it.",
  questions: [
    {
      id: "position",
      screen: "identity",
      label: "Position you are applying for",
      kind: "text",
    },
    {
      id: "heard_from",
      screen: "identity",
      label: "How did you hear about this company?",
      kind: "text",
    },
    {
      id: "legally_work",
      screen: "identity",
      label: "Can you legally work in the USA?",
      kind: "boolean",
    },
    {
      id: "proof_of_age",
      screen: "identity",
      label: "Do you have proof of age?",
      kind: "boolean",
      /**
       * ⚠ This read "§391.11(b)(1) sets the federal minimum at 21. Silvicom's own policy is 23." and
       * it had done since A9. **D-UI9 forbids a CFR citation on any screen a driver reads** — and no
       * gate could see this one: `strings.test.ts` walks `APPLY_COPY`, and the carrier's questions are
       * not in it. Found 2026-09-11 only because D-AX7 moved this question onto a screen that one
       * assertion happened to check. The gate now walks this definition too.
       *
       * The substance is unchanged; only the paragraph number is gone. The audience argument is the
       * whole of D-UI9: a citation is an instrument for arguing with an auditor, and the person being
       * asked for their proof of age is not one.
       */
      hint: "The federal minimum age is 21. Silvicom's own policy is 23.",
    },
    {
      id: "may_contact_employers",
      /**
       * ⚠ **The one deliberate departure from the paper's layout** (D-AX7). The workbook has this on
       * page 1 with the other four; it is asked on the EMPLOYMENT screen instead, directly above the
       * list of employers. Asking a driver for permission to contact employers they have not yet
       * named is a question with no referent — they cannot picture who is being asked about. Moving
       * where it is asked changes nothing about what is asked.
       */
      screen: "employment",
      label: "May we contact your previous employers?",
      kind: "boolean",
      /**
       * ⚠ Worth a recruiter's attention and NOT a gate. §391.23 obliges the carrier to investigate
       * the previous three years of employment whatever the driver says here, and the signed
       * previous-employer release is what authorizes it. A "no" beside a signed release is a
       * contradiction a person should look at — it is not something the form can resolve.
       */
      hint: "We are required to check your safety performance history either way; this tells us how you would prefer we go about it.",
    },
    {
      id: "education",
      label: "Education and training",
      kind: "table",
      hint: "Most recent first.",
      columns: [
        { id: "school", label: "School or university", kind: "text" },
        { id: "years_completed", label: "Years completed", kind: "number" },
        { id: "field_of_study", label: "Field of study", kind: "text" },
        { id: "graduated", label: "Graduated", kind: "boolean" },
        { id: "graduated_when", label: "When", kind: "text" },
      ],
      maxRows: 6,
    },
    {
      id: "military_service",
      label: "Have you ever served in the military?",
      kind: "boolean",
    },
    {
      id: "military_when",
      label: "If so, when?",
      kind: "text",
    },
    {
      id: "other_training",
      label: "Any other training that would help you in this position",
      kind: "longtext",
    },
    {
      id: "references",
      label: "Three personal references",
      kind: "table",
      hint: "Not relatives, and not former supervisors.",
      columns: [
        { id: "full_name", label: "Full name", kind: "text" },
        { id: "years_known", label: "Years known", kind: "number" },
        { id: "phone", label: "Phone number", kind: "text" },
      ],
      maxRows: 3,
    },
  ],
};

/**
 * What the applicant is applying as (Q-HM14, ruled (b) on 2026-09-24).
 *
 * ── WHY THIS ONE ANSWER IS STRUCTURED ─────────────────────────────────────────────────────────
 * The carrier engages company drivers and owner-operators, and its packet asks which one twice
 * without a question to answer it from: page 22's `This test is required for:` box and page 31's
 * owner-operator block. The nearest thing held before this was the free-text `position` answer, and
 * choosing a box on a federal form from words somebody typed would be inference printed onto it.
 * Memorandum Q14 asks counsel whether the two groups need different packets, and **whatever counsel
 * answers, the product needs the fact per applicant.**
 *
 * ⚠ **The one questionnaire answer that DECIDES something.** D-APP12 still holds for it: it is
 * projected onto no table and creates no DQF item. What it decides is what the packet prints and
 * which lines the applicant signs (`driverPlacements`), both of which are derivatives of the payload
 * it is stored in.
 */
export const APPLYING_AS = ["company_driver", "owner_operator"] as const;
export type ApplyingAs = (typeof APPLYING_AS)[number];
export const APPLYING_AS_QUESTION_ID = "applying_as";

/**
 * Version 2 adds `applying_as` (Q-HM14) and changes nothing else. The set of questions changed, so
 * the version did — a v1 answer set is still read beside v1's questions (`QUESTIONNAIRES`).
 */
export const SILVICOM_DRIVER_V2: QuestionnaireDefinition = {
  ...SILVICOM_DRIVER_V1,
  version: "v2",
  questions: [
    SILVICOM_DRIVER_V1.questions[0]!,
    {
      id: APPLYING_AS_QUESTION_ID,
      // Beside `position`, where the carrier's page 1 asks what the applicant is applying for.
      screen: "identity",
      label: "Are you applying as a company driver or as an owner-operator?",
      kind: "select",
      choices: [
        { value: "company_driver", label: "Company driver" },
        { value: "owner_operator", label: "Owner-operator" },
      ],
      hint: "Choose owner-operator if you will drive a truck you own or lease, under contract with Silvicom.",
    },
    ...SILVICOM_DRIVER_V1.questions.slice(1),
  ],
};

/** A skip that says the applicant chose not to answer. */
const RATHER_NOT_SAY: QuestionChoice = { value: "I'd rather not say", label: "I'd rather not say" };
/** A skip that says the question is not about them. */
const DOES_NOT_APPLY: QuestionChoice = { value: "Doesn't apply", label: "Doesn't apply" };

/**
 * Version 3 (§9 P8, HIRING-WORKFLOW-AUDIT §3.3/§4.4): the same eleven questions, asked differently.
 *
 *   · Q-WF3's seven are `required` — position, applying as, heard from, legally able to work, proof of
 *     age, may we contact employers, education (AF-1).
 *   · Every other question has a `skip`, so "I'd rather not say" is an answer the office can read.
 *   · "If so, when?" is asked only after a "yes" to military service (AF-6).
 *   · The intro stops telling the applicant these "are not part of the federal application" — an
 *     invitation to skip, and half untrue once five of them moved to the first screen (AF-3).
 *   · The proof-of-age hint says what the carrier requires instead of contrasting it with a federal
 *     number the applicant cannot act on (AF-7). Same policy, plainer words.
 *
 * ⚠ A new VERSION and not an edit to v2, by this file's own rule: what somebody answered means
 * something only beside the exact question they were asked, and an answer given when nothing was
 * required is read beside v2 for good (`questionnaireByRef`). Ids, kinds and columns are v2's, so a v2
 * answer set parses against v3 and a draft started on v2 keeps its answers.
 */
const v2 = (id: string): QuestionnaireQuestion => SILVICOM_DRIVER_V2.questions.find((q) => q.id === id)!;
export const SILVICOM_DRIVER_V3: QuestionnaireDefinition = {
  ...SILVICOM_DRIVER_V2,
  version: "v3",
  intro: "A few more questions about you. They help us place you on the right truck.",
  questions: [
    { ...v2("position"), required: true },
    { ...v2(APPLYING_AS_QUESTION_ID), required: true },
    { ...v2("heard_from"), required: true },
    { ...v2("legally_work"), required: true },
    {
      ...v2("proof_of_age"),
      required: true,
      hint: "Silvicom hires drivers who are 23 or older. A driver's licence, passport or birth certificate shows your age.",
    },
    { ...v2("may_contact_employers"), required: true },
    { ...v2("education"), required: true },
    { ...v2("military_service"), skip: RATHER_NOT_SAY },
    { ...v2("military_when"), skip: RATHER_NOT_SAY, askedWhen: { question: "military_service", is: true } },
    { ...v2("other_training"), skip: DOES_NOT_APPLY },
    { ...v2("references"), skip: RATHER_NOT_SAY },
  ],
};

/**
 * The definition a draft saved before drafts remembered their version was answered against (§9 P8).
 *
 * ⚠ A fact about history, not a choice: v2 was the only definition served from Q-HM14 (2026-09-24)
 * until v3, so every answer in a draft that names no version was given against it. `fromDraftPayload`
 * reads it for exactly those drafts — the one handed to the office on 2026-10-21 among them — so their
 * certification is judged by the questions their applicant saw.
 */
export const QUESTIONNAIRE_BEFORE_DRAFTS_REMEMBERED = `${SILVICOM_DRIVER_V2.id}@${SILVICOM_DRIVER_V2.version}`;

/**
 * The definition an applicant is served.
 *
 * ⚠ One carrier, one definition, and NO org column — deliberately. A9 says definitions are
 * "org-scoped by id", and the id is the scope: `silvicom_driver`. Spending a migration on a column
 * that would hold the same value in every row of a one-row table is the kind of generality that reads
 * as a feature and is really an unused join. The day a second carrier's form differs, the selection
 * becomes a column on `organizations` and this function grows an argument.
 */
export const questionnaireForApplicant = (): QuestionnaireDefinition => SILVICOM_DRIVER_V3;

/**
 * The questions asked on one screen, in the definition's own order.
 *
 * ⚠ Derived from the definition rather than listed per screen, because a list would be a second
 * place to forget a question. A question with no `screen` belongs to `questions`, which is what every
 * definition written before D-AX7 means and what a carrier adding one without thinking about it
 * should get.
 */
export const questionsForScreen = (
  def: QuestionnaireDefinition,
  screen: ApplicationSection,
): readonly QuestionnaireQuestion[] =>
  def.questions.filter((q) => (q.screen ?? "questions") === screen);

/** Every definition that has ever been served, by `id@version` — a stored answer names one of these. */
export const QUESTIONNAIRES: Record<string, QuestionnaireDefinition> = {
  [`${SILVICOM_DRIVER_V1.id}@${SILVICOM_DRIVER_V1.version}`]: SILVICOM_DRIVER_V1,
  [`${SILVICOM_DRIVER_V2.id}@${SILVICOM_DRIVER_V2.version}`]: SILVICOM_DRIVER_V2,
  [`${SILVICOM_DRIVER_V3.id}@${SILVICOM_DRIVER_V3.version}`]: SILVICOM_DRIVER_V3,
};

export const questionnaireRef = (def: QuestionnaireDefinition): string => `${def.id}@${def.version}`;

/**
 * A stored answer set is only readable beside the questions it answered.
 *
 * Returns null for a version nobody has ever served, which is a real state: `payload` is historical
 * jsonb, and a document filed against a definition this build no longer carries must still render —
 * the same rule `render.ts` applies to every other field it reads (a derivative that throws on an old
 * payload is a qualification file that cannot be produced).
 */
export const questionnaireByRef = (ref: string | null | undefined): QuestionnaireDefinition | null =>
  (ref ? QUESTIONNAIRES[ref] ?? null : null);
