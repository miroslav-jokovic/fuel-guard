import { z } from "zod";
import {
  QUESTION_KINDS,
  RATHER_NOT_SAY,
  type QuestionKind,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from "./questionnaireContract.js";
import { isAnswered, questionnaireAnswersSchema } from "./questionnaireAnswers.js";
import { recordId } from "./recordId.js";

/**
 * Questions the carrier writes itself (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3, D-CQ1..D-CQ5; the table is 0567).
 *
 * ── A STAMPED QUESTION IS A QUESTIONNAIRE QUESTION ────────────────────────────────────────────
 * 0567's `kind` is the questionnaire's own vocabulary less `table`, so the set stamped on an invitation
 * becomes a `QuestionnaireDefinition` (`carrierQuestionnaire`) and everything that already reads one —
 * the wizard's fields, the answer schema, `isAnswered`, the filed PDF's questionnaire page — reads the
 * carrier's questions too. Nothing here draws a field or prints a page.
 *
 * ── THE STAMP, NEVER THE LIST, DECIDES (D-CQ2) ────────────────────────────────────────────────
 * The office's first Send copies the live list onto the invitation. The applicant answers that copy, the
 * API validates against its own copy of it (never the page's), and the filed payload carries it beside
 * the answers — so a question retired later still prints on the application that asked it.
 *
 * ── ANSWERS (D-CQ3) ───────────────────────────────────────────────────────────────────────────
 * `carrier_answers`, keyed by question id. A required question has no skip; an optional one offers
 * "I'd rather not say" — the built-in questions' `RATHER_NOT_SAY`, so both read alike on the office's
 * screen. A `select` is narrowed to its own choices: they are frozen (CQ011), so an answer outside them
 * is not an older wording, it is wrong.
 *
 * ⚠ The lengths are 0567's CHECKs, restated so the browser can say so before a round trip; the database
 * stays the authority.
 */

/** 0567's kinds: `QUESTION_KINDS` less the grid, derived rather than listed. */
export const CARRIER_QUESTION_KINDS = QUESTION_KINDS.filter((k) => k !== "table") as Exclude<QuestionKind, "table">[];
export type CarrierQuestionKind = Exclude<QuestionKind, "table">;

/** What each kind is called in the settings list. */
export const CARRIER_QUESTION_KIND_LABELS: Record<CarrierQuestionKind, string> = {
  text: "Short answer",
  longtext: "Long answer",
  boolean: "Yes or no",
  select: "One of a list",
  date: "A date",
  number: "A number",
};

/** D-CQ5 — 0567's bounds. */
export const CARRIER_QUESTIONS_LIVE_MAX = 20;
export const CARRIER_QUESTION_WORDING_MAX = 300;
export const CARRIER_QUESTION_HINT_MAX = 300;
export const CARRIER_QUESTION_CHOICES_MIN = 2;
export const CARRIER_QUESTION_CHOICES_MAX = 20;
export const CARRIER_QUESTION_CHOICE_MAX = 80;
export const CARRIER_QUESTION_POSITION_MAX = 1000;

const wording = z.string().trim()
  .min(1, "Write the question.")
  .max(CARRIER_QUESTION_WORDING_MAX, `A question can be at most ${CARRIER_QUESTION_WORDING_MAX} characters.`);
const hint = z.string().trim()
  .max(CARRIER_QUESTION_HINT_MAX, `Keep the hint under ${CARRIER_QUESTION_HINT_MAX} characters.`)
  .transform((v) => (v === "" ? null : v))
  .nullable();
const choice = z.string().trim()
  .min(1, "A choice cannot be blank.")
  .max(CARRIER_QUESTION_CHOICE_MAX, `A choice can be at most ${CARRIER_QUESTION_CHOICE_MAX} characters.`);
const kind = z.enum(CARRIER_QUESTION_KINDS as [CarrierQuestionKind, ...CarrierQuestionKind[]], {
  message: "Choose what kind of answer you want.",
});

/** A new question. What it asks — wording, kind, choices — is fixed from here on (CQ011). */
export const carrierQuestionCreateSchema = z
  .object({
    wording,
    hint: hint.optional().default(null),
    kind,
    choices: z.array(choice).max(CARRIER_QUESTION_CHOICES_MAX).nullable().optional().default(null),
    required: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "select") {
      if (!v.choices || v.choices.length < CARRIER_QUESTION_CHOICES_MIN) {
        ctx.addIssue({ code: "custom", path: ["choices"], message: `Give at least ${CARRIER_QUESTION_CHOICES_MIN} choices.` });
      } else if (new Set(v.choices).size !== v.choices.length) {
        ctx.addIssue({ code: "custom", path: ["choices"], message: "Each choice must be different." });
      }
    } else if (v.choices && v.choices.length > 0) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "Only a one-of-a-list question has choices." });
    }
  })
  .transform((v) => ({ ...v, choices: v.kind === "select" ? v.choices : null }));
export type CarrierQuestionCreate = z.infer<typeof carrierQuestionCreateSchema>;

/** What the office may change: the hint, whether it is required, its place — or retire it (CQ012). */
export const carrierQuestionUpdateSchema = z
  .object({
    hint: hint.optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(CARRIER_QUESTION_POSITION_MAX).optional(),
    retire: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type CarrierQuestionUpdate = z.infer<typeof carrierQuestionUpdateSchema>;

/** One question on the carrier's list, as the API returns it — 0567's row. */
export interface CarrierQuestion {
  id: string;
  wording: string;
  hint: string | null;
  kind: CarrierQuestionKind;
  choices: string[] | null;
  required: boolean;
  position: number;
  created_at: string;
  retired_at: string | null;
}

/** One stamped question (D-CQ2): what the applicant was asked, exactly. */
export const carrierQuestionStampItemSchema = z.object({
  id: recordId(),
  wording: z.string().min(1).max(CARRIER_QUESTION_WORDING_MAX),
  hint: z.string().max(CARRIER_QUESTION_HINT_MAX).nullable(),
  kind,
  choices: z.array(z.string().min(1).max(CARRIER_QUESTION_CHOICE_MAX)).max(CARRIER_QUESTION_CHOICES_MAX).nullable(),
  required: z.boolean(),
});
export type CarrierQuestionStampItem = z.infer<typeof carrierQuestionStampItemSchema>;
export const carrierQuestionStampSchema = z.array(carrierQuestionStampItemSchema).max(CARRIER_QUESTIONS_LIVE_MAX);
export type CarrierQuestionStamp = z.infer<typeof carrierQuestionStampSchema>;

/** What the office's Send stamps: the live list, in its order, as the applicant will be asked it. */
export const carrierQuestionsToStamp = (live: readonly CarrierQuestion[]): CarrierQuestionStamp =>
  live
    .filter((q) => q.retired_at === null)
    .slice(0, CARRIER_QUESTIONS_LIVE_MAX)
    .map((q) => ({ id: q.id, wording: q.wording, hint: q.hint, kind: q.kind, choices: q.choices, required: q.required }));

/**
 * A stored stamp as the readers take it — narrowed, never trusted: a payload is historical jsonb, and a
 * malformed one reads as "no carrier questions" rather than throwing on a filed document.
 */
export function carrierStampOf(raw: unknown): CarrierQuestionStamp {
  const parsed = carrierQuestionStampSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** The id the carrier's questions are filed under, beside `silvicom_driver@v3`. */
export const CARRIER_QUESTIONNAIRE_ID = "carrier";

/** One stamped question as a questionnaire question (D-CQ3: optional ones may be skipped). */
export function carrierQuestionAsQuestion(q: CarrierQuestionStampItem): QuestionnaireQuestion {
  return {
    id: q.id,
    label: q.wording,
    kind: q.kind,
    ...(q.hint ? { hint: q.hint } : {}),
    // Keyed by its own words: the choices are frozen, so the value IS what the applicant read.
    ...(q.kind === "select" && q.choices ? { choices: q.choices.map((c) => ({ value: c, label: c })) } : {}),
    ...(q.required ? { required: true as const } : { skip: RATHER_NOT_SAY }),
  };
}

/** The stamp as a questionnaire, so the wizard, the review and the PDF read it like the built-in one. */
export const carrierQuestionnaire = (stamp: readonly CarrierQuestionStampItem[]): QuestionnaireDefinition => ({
  id: CARRIER_QUESTIONNAIRE_ID,
  version: "stamp",
  title: "Our own questions",
  intro: "",
  questions: stamp.map(carrierQuestionAsQuestion),
});

/**
 * What is wrong with these answers to this stamp (D-CQ3) — the one check the wizard and the API share
 * (`applicationContract.ts`'s cross-field rules). Paths are `["carrier_answers", id]`.
 *
 * ⚠ An answer to an id the stamp does not hold is NOT reported: the submit path drops it
 * (`answersToStamp`), so a page served before a resend's stamp cannot be refused for a key it was given.
 */
export function carrierAnswerIssues(
  stamp: readonly CarrierQuestionStampItem[] | null | undefined,
  answers: Record<string, unknown> | null | undefined,
): { path: (string | number)[]; message: string }[] {
  if (!stamp || stamp.length === 0) return [];
  const given = answers ?? {};
  const out: { path: (string | number)[]; message: string }[] = [];
  const def = carrierQuestionnaire(stamp);
  const shapes = (questionnaireAnswersSchema(def) as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
  for (const q of def.questions) {
    const raw = given[q.id];
    if (isAnswered(raw) && !shapes[q.id]!.safeParse(raw).success) {
      out.push({ path: ["carrier_answers", q.id], message: `That is not an answer to "${q.label}"` });
    } else if (q.required && !isAnswered(raw)) {
      out.push({ path: ["carrier_answers", q.id], message: `Answer the question "${q.label}"` });
    }
  }
  return out;
}

/** The answers kept for filing: the stamp's ids only, answered ones only. */
export function answersToStamp(
  stamp: readonly CarrierQuestionStampItem[],
  answers: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const kept = Object.fromEntries(stamp.filter((q) => isAnswered(answers?.[q.id])).map((q) => [q.id, answers![q.id]]));
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * Why an office correction of one of the carrier's own answers is refused, or null (APPLICATION-FIX-PLAN
 * F3c part 2, step 5).
 *
 * ── THE STAMP ON THE INVITATION, NEVER THE DRAFT ──────────────────────────────────────────────
 * The draft holds `carrier_answers` as an open record and does not carry the questions (Q-CQ7), so the
 * draft schema cannot check a correction — before step 5 a `set` at `["carrier_answers", id]` was taken
 * for any id and any value. The API passes the invitation's own stamp: the questions THIS applicant was
 * asked, which filing checks the answers against (`carrierAnswerIssues`). A correction filing would
 * refuse is refused here, while the office can still read why.
 *
 * ⚠ A blank is refused, required or not. The applicant's form does not let an optional question be left
 * blank either — it is answered or skipped with its own words ("I'd rather not say"), and the card
 * offers that skip as the form does.
 */
export function carrierAnswerRefusal(
  stamp: readonly CarrierQuestionStampItem[],
  path: readonly (string | number)[],
  value: unknown,
): string | null {
  if (path.length !== 2 || typeof path[1] !== "string") {
    return "The carrier's own questions are corrected one answer at a time. Reload the application and try again.";
  }
  const asked = stamp.find((q) => q.id === path[1]);
  if (!asked) return "That question was not asked on this application. Reload it and try again.";
  const question = carrierQuestionAsQuestion(asked);
  if (!isAnswered(value)) {
    return question.skip ? `Give an answer, or choose "${question.skip.label}".` : `"${asked.wording}" must be answered.`;
  }
  const shapes = (questionnaireAnswersSchema(carrierQuestionnaire([asked])) as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
  return shapes[asked.id]!.safeParse(value).success ? null : `That is not an answer to "${asked.wording}".`;
}
