import { z } from "zod";
import type { ApplicationSection } from "./applicationSections.js";
import {
  APPLYING_AS,
  APPLYING_AS_QUESTION_ID,
  EEO_ANSWER_KEY,
  questionsForScreen,
  type ApplyingAs,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from "./questionnaireContract.js";

/**
 * The carrier's questions' ANSWERS — their schema and the readers every screen and document share.
 *
 * Split out of `questionnaireContract.ts` on 2026-11-01 (§9 P8), when v3 took that file past the
 * 500-line budget. The seam is the one the file already had: the definitions above it say what is
 * asked, everything here reads what was answered. Re-exported unchanged through `index.ts`.
 */

/**
 * One answer's shape, from its question.
 *
 * Everything is nullish: an answer set is saved long before it is finished, and a `required` question
 * is refused by its cross-field rule (`applicationRules.ts`, §9 P8), which names the question, rather
 * than by a type error here, which could not. A question with a `skip` also takes that one string.
 */
function answerSchema(q: QuestionnaireQuestion): z.ZodTypeAny {
  const shape = baseAnswerSchema(q);
  return q.skip ? z.union([shape, z.literal(q.skip.value)]).nullish() : shape.nullish();
}

function baseAnswerSchema(q: QuestionnaireQuestion): z.ZodTypeAny {
  switch (q.kind) {
    case "boolean":
      return z.boolean();
    case "number":
      return z.coerce.number();
    case "longtext":
      return z.string().max(4000);
    case "table":
      return z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .max(q.maxRows ?? 20);
    case "select":
      // ⚠ A keyed `select` IS narrowed: code matches on its value, so a value outside the keys would
      // be read as no answer by `applyingAsOf` while sitting in a filed payload looking like one.
      if (q.choices) {
        return z.enum(q.choices.map((c) => c.value) as [string, ...string[]]);
      }
      return z.string().max(500);
    default:
      // text, select and date are all stored as strings. `select` is NOT narrowed to its options
      // here: the options may change between versions, and a stored answer from an older definition
      // must still parse — it is displayed beside the question that produced it, never matched on.
      return z.string().max(500);
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

/**
 * The answers inside a stored payload, DRAFT OR FILED.
 *
 * ⚠ **Two keys, one set of answers.** A draft holds them as `questionnaire`, the form's own shape; a
 * filed application holds `questionnaire_answers`, written at submit beside the definition's ref
 * (`applicationContract.ts`). The packet is rendered from both — the office's preview and the reading
 * copy the applicant signs beside are drawn from the DRAFT — and a reader of one key only prints the
 * page the applicant signs differently from the page that is filed.
 */
export function questionnaireAnswersOf(payload: unknown): Record<string, unknown> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  for (const key of ["questionnaire_answers", "questionnaire"]) {
    const v = p[key];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return {};
}

/**
 * What a stored payload says the applicant is applying as, or null.
 *
 * ⚠ **Null is a real answer and it means the PAPER** (Q-HM14). A payload filed before the question
 * existed has none, `driver_applications` is append-only so it never will, and an answer set
 * given against v1 or v2 required nothing (v3 requires it, §9 P8). Every consumer reads null as the packet as
 * the carrier printed it — nothing withdrawn, no reason ticked — because choosing either value for
 * somebody who never gave one would be inference printed onto a signed document.
 */
export function applyingAsOf(payload: unknown): ApplyingAs | null {
  return asApplyingAs(questionnaireAnswersOf(payload)[APPLYING_AS_QUESTION_ID]);
}

/** One stored value narrowed to the two keys — for a reader that selected the key alone. */
export const asApplyingAs = (v: unknown): ApplyingAs | null =>
  (APPLYING_AS as readonly unknown[]).includes(v) ? (v as ApplyingAs) : null;

/**
 * A stored answer as a person reads it: a keyed choice's LABEL, and anything else unchanged.
 *
 * ⚠ Every screen and document that shows an answer goes through this, because a keyed answer shown
 * raw is `owner_operator` printed on a qualification file. Unchanged for everything else, so the
 * caller's own rules for booleans and blanks still apply after it.
 */
export function choiceLabel(q: QuestionnaireQuestion, raw: unknown): unknown {
  if (q.skip && raw === q.skip.value) return q.skip.label;
  return q.choices?.find((c) => c.value === raw)?.label ?? raw;
}

/** Has the applicant given this answer — or, for an optional question, its `skip`? */
export function isAnswered(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "string") return raw.trim() !== "";
  if (Array.isArray(raw)) return raw.length > 0;
  return true;
}

/**
 * Is this question asked, given the answers so far? Only `askedWhen` makes it conditional; a question
 * not asked is neither required nor counted, and the screen does not show it.
 */
export function isAsked(q: QuestionnaireQuestion, answers: Record<string, unknown>): boolean {
  return !q.askedWhen || answers[q.askedWhen.question] === q.askedWhen.is;
}

/**
 * How many of one screen's asked questions are answered (§9 P8, AF-2) — what the task list says
 * instead of "Optional". Derived from the definition, so a question added to the screen is counted.
 */
export function questionnaireProgress(
  def: QuestionnaireDefinition,
  screen: ApplicationSection,
  answers: Record<string, unknown>,
): { answered: number; total: number } {
  const asked = questionsForScreen(def, screen).filter((q) => isAsked(q, answers));
  return { answered: asked.filter((q) => isAnswered(answers[q.id])).length, total: asked.length };
}

/** What a reader may see: everything except the reserved EEO key. */
export function readableAnswers(
  answers: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!answers) return {};
  const { [EEO_ANSWER_KEY]: _eeo, ...rest } = answers;
  return rest;
}
