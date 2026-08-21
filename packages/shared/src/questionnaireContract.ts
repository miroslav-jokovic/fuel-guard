import { z } from "zod";

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
  /** Shown under the field. Where the packet explains itself, the explanation comes across. */
  hint?: string;
  /** Required for `select`. */
  options?: readonly string[];
  /** Required for `table`. */
  columns?: readonly QuestionColumn[];
  /** `table` only — how many rows the driver is asked for. The packet asks for three references. */
  maxRows?: number;
}

/**
 * ⚠ THERE IS NO `required` FLAG, AND A9'S TEXT ASKS FOR ONE. The reason is worth the paragraph.
 *
 * A flag has to be enforced somewhere, and there are only two places: the wizard screen, and the
 * schema. Enforcing it in the screen alone breaks the property A3 built the wizard on — the client
 * validates with the SERVER'S OWN object, so the two can never disagree about what is required.
 * Enforcing it in the schema means a carrier's own question can refuse a §391.21 application, which
 * is the opposite of the decision A8a already took for photographs: a driver must not lose a
 * federally-required filing to a question the regulation never asked.
 *
 * A flag enforced in neither place is decoration that reads as a rule, and one enforced in one place
 * is a client/server disagreement waiting for its first crafted request. So the questionnaire blocks
 * nothing, both validators accept everything, and they agree exactly. If the carrier later wants an
 * answer made mandatory, the honest shape is an `APPLICATION_CROSS_FIELD_RULES` entry — which lands
 * in `driverApplicationSchema` and therefore in both validators at once — and that is a decision
 * somebody should make on purpose rather than inherit from an unused flag.
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
      label: "Position you are applying for",
      kind: "text",
    },
    {
      id: "heard_from",
      label: "How did you hear about this company?",
      kind: "text",
    },
    {
      id: "legally_work",
      label: "Can you legally work in the USA?",
      kind: "boolean",
    },
    {
      id: "proof_of_age",
      label: "Do you have proof of age?",
      kind: "boolean",
      hint: "§391.11(b)(1) sets the federal minimum at 21. Silvicom's own policy is 23.",
    },
    {
      id: "may_contact_employers",
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
 * The definition an applicant is served.
 *
 * ⚠ One carrier, one definition, and NO org column — deliberately. A9 says definitions are
 * "org-scoped by id", and the id is the scope: `silvicom_driver`. Spending a migration on a column
 * that would hold the same value in every row of a one-row table is the kind of generality that reads
 * as a feature and is really an unused join. The day a second carrier's form differs, the selection
 * becomes a column on `organizations` and this function grows an argument.
 */
export const questionnaireForApplicant = (): QuestionnaireDefinition => SILVICOM_DRIVER_V1;

/** Every definition that has ever been served, by `id@version` — a stored answer names one of these. */
export const QUESTIONNAIRES: Record<string, QuestionnaireDefinition> = {
  [`${SILVICOM_DRIVER_V1.id}@${SILVICOM_DRIVER_V1.version}`]: SILVICOM_DRIVER_V1,
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

/**
 * One answer's shape, from its question.
 *
 * Everything is nullish. The questionnaire is answered inside the §391.21 flow and must never be what
 * stops a federally-required application being sent — `required` is enforced by the wizard screen
 * that collects it, not by the schema that stores it, for the same reason `APPLICATION_CAPTURE_REQUIRED`
 * is empty (A8a): a carrier's own question is not worth a lost candidate.
 */
function answerSchema(q: QuestionnaireQuestion): z.ZodTypeAny {
  switch (q.kind) {
    case "boolean":
      return z.boolean().nullish();
    case "number":
      return z.coerce.number().nullish();
    case "longtext":
      return z.string().max(4000).nullish();
    case "table":
      return z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .max(q.maxRows ?? 20)
        .nullish();
    default:
      // text, select and date are all stored as strings. `select` is NOT narrowed to its options
      // here: the options may change between versions, and a stored answer from an older definition
      // must still parse — it is displayed beside the question that produced it, never matched on.
      return z.string().max(500).nullish();
  }
}

/** The answers object for one definition — plus the reserved, never-rendered `eeo` key. */
export function questionnaireAnswersSchema(def: QuestionnaireDefinition): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of def.questions) shape[q.id] = answerSchema(q);
  shape[EEO_ANSWER_KEY] = z.record(z.string(), z.unknown()).nullish();
  // NOT `.strict()`, unlike the regulated contract: an answer set filed against a definition that has
  // since gained a question must still parse, and the extra key is displayed beside nothing and
  // therefore harms nothing.
  return z.object(shape).partial();
}

/** What a reader may see: everything except the reserved EEO key. */
export function readableAnswers(
  answers: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!answers) return {};
  const { [EEO_ANSWER_KEY]: _eeo, ...rest } = answers;
  return rest;
}
