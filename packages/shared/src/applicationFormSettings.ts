import { z } from "zod";
import {
  APPLICATION_CAPTURE_REQUESTED,
  PART_ONE_CAPTURE_SLOTS,
  type ApplicationCaptureSlot,
} from "./applicationCaptureContract.js";
import {
  questionnaireForApplicant,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from "./questionnaireContract.js";

/**
 * The carrier's required questions and the documents it asks for, as settings
 * (HIRING-WORKFLOW-AUDIT-2026-10-31 §11, D-RS1…D-RS7; columns 0550).
 *
 * ── WHAT IS DERIVED HERE, AND WHY NOT IN SQL ───────────────────────────────────────────────────
 * Which questions MAY be required and which slots MAY be withheld are facts of the questionnaire
 * definition and of the capture catalogue, so they are computed from those two, never listed: 0550's
 * columns check only the SHAPE of an id, the way 0545 left `hidden_hiring_steps` to `hiringSteps.ts`
 * (§10 D-CE3). A stored id the catalogue does not have is dropped on read, never trusted.
 *
 * ── THE STAMP, NOT THE SETTING, DECIDES AN APPLICANT'S RULES (D-RS3, D-RS4) ────────────────────
 * The setting is what the carrier wants for applicants it has not sent yet. The office's first Send
 * copies it onto the invitation (`application_invitations.required_questions`), and from then on that
 * copy is what this applicant is held to — so a question made required on Tuesday never refuses, on
 * Thursday, somebody who answered on Monday without being asked for it. Null on an invitation means it
 * was sent before 0550's reader, and reads exactly as before: the flags of the draft's own definition.
 */

/**
 * The questions a carrier may require of this definition (D-RS2): all of them except one asked only
 * after another question's answer ("If so, when?" — required, it would refuse an applicant who was
 * never shown it).
 */
export const isRequirableQuestion = (q: QuestionnaireQuestion): boolean =>
  !q.askedWhen;

export const requirableQuestions = (
  def: QuestionnaireDefinition = questionnaireForApplicant(),
): readonly QuestionnaireQuestion[] => def.questions.filter(isRequirableQuestion);

/** The served definition's requirable ids — the settings contract's vocabulary. */
export const REQUIRABLE_QUESTION_IDS: readonly string[] = requirableQuestions().map((q) => q.id);

/** The product's default (D-RS1): what the served definition itself marks `required` — Q-WF3's seven. */
export const defaultRequiredQuestions = (
  def: QuestionnaireDefinition = questionnaireForApplicant(),
): readonly string[] => def.questions.filter((q) => q.required).map((q) => q.id);

/**
 * The definition as THIS applicant is asked it: the stamp's questions required, every other question
 * optional, and a required question without its skip (D-RS5 — "I'd rather not say" is not an answer to
 * a question the carrier requires). A null stamp returns the definition untouched.
 *
 * ⚠ Every reader of `required` (the screen's mark, the review's missing list, the task hub's count, the
 * cross-field rule) takes the definition through this, so none of them holds a second copy of the set.
 */
export function withRequiredQuestions(
  def: QuestionnaireDefinition,
  stamp: readonly string[] | null | undefined,
): QuestionnaireDefinition {
  if (stamp == null) return def;
  const required = new Set(stamp);
  return {
    ...def,
    questions: def.questions.map((q) => {
      const { required: _flag, skip, ...rest } = q;
      if (isRequirableQuestion(q) && required.has(q.id)) return { ...rest, required: true as const };
      return skip ? { ...rest, skip } : rest;
    }),
  };
}

/** The ids this applicant must answer — through `withRequiredQuestions`, never beside it. */
export const requiredQuestionIds = (
  def: QuestionnaireDefinition,
  stamp: readonly string[] | null | undefined,
): readonly string[] => withRequiredQuestions(def, stamp).questions.filter((q) => q.required).map((q) => q.id);

/**
 * What the office's Send stamps (D-RS3): the carrier's set, else the product default — always an array,
 * so an invitation sent after 0550's reader is never confused with one sent before it. Unknown ids are
 * dropped here as well as on read.
 */
export const requiredQuestionsToStamp = (setting: readonly string[] | null | undefined): string[] =>
  (setting ?? defaultRequiredQuestions()).filter((id) => REQUIRABLE_QUESTION_IDS.includes(id));

/** A stored or submitted set, narrowed to ids the served definition may require; null stays null. */
export const requiredQuestionsOf = (stored: readonly string[] | null | undefined): string[] | null =>
  stored == null ? null : [...new Set(stored.filter((id) => REQUIRABLE_QUESTION_IDS.includes(id)))];

/** The settings PUT's shape: requirable ids only, deduplicated; null = "use the standard set". */
export const requiredQuestionsSchema = z
  .array(z.enum(REQUIRABLE_QUESTION_IDS as [string, ...string[]]))
  .max(REQUIRABLE_QUESTION_IDS.length)
  .transform((v) => [...new Set(v)])
  .nullable();

// ── documents offered (D-RS6) ───────────────────────────────────────────────────────────────────

/**
 * Always offered, whatever the carrier sets: the licence Part 1 photographed (§391.21(b)(4)'s
 * licence, shown again and never re-asked, §9 P9) and the medical card — a §391.41/§391.43 item of the
 * qualification file, which Part 1 already asks about ("or I don't have one yet").
 */
export const ALWAYS_OFFERED_CAPTURE_SLOTS: readonly ApplicationCaptureSlot[] = [...PART_ONE_CAPTURE_SLOTS, "medical_card"];

/** The slots a carrier may stop asking for: Part 2's list less the ones above. */
export const WITHHOLDABLE_CAPTURE_SLOTS: readonly ApplicationCaptureSlot[] = APPLICATION_CAPTURE_REQUESTED.filter(
  (s) => !ALWAYS_OFFERED_CAPTURE_SLOTS.includes(s),
);

/**
 * The slots Part 2's "Your documents" offers, in the catalogue's order. Null = every slot (P9's
 * behaviour). The setting names the withholdable slots the carrier DOES ask for; an id that is not one
 * is ignored, and the always-offered slots are offered whatever it says.
 */
export const offeredCaptureSlots = (
  setting: readonly string[] | null | undefined,
): readonly ApplicationCaptureSlot[] =>
  setting == null
    ? APPLICATION_CAPTURE_REQUESTED
    : APPLICATION_CAPTURE_REQUESTED.filter((s) => ALWAYS_OFFERED_CAPTURE_SLOTS.includes(s) || setting.includes(s));

/**
 * May a capture be staged in this slot? Only a withholdable slot the carrier withheld is refused — the
 * selfie and the two marks are not Part 2's list and are never this setting's.
 */
export const captureSlotOffered = (
  slot: ApplicationCaptureSlot,
  setting: readonly string[] | null | undefined,
): boolean => !WITHHOLDABLE_CAPTURE_SLOTS.includes(slot) || offeredCaptureSlots(setting).includes(slot);

/** A stored set, narrowed to withholdable slots; null stays null. */
export const offeredDocumentSlotsOf = (stored: readonly string[] | null | undefined): ApplicationCaptureSlot[] | null =>
  stored == null
    ? null
    : WITHHOLDABLE_CAPTURE_SLOTS.filter((s) => stored.includes(s));

/** The settings PUT's shape: withholdable slots only, deduplicated; null = "ask for every document". */
export const offeredDocumentSlotsSchema = z
  .array(z.enum(WITHHOLDABLE_CAPTURE_SLOTS as [ApplicationCaptureSlot, ...ApplicationCaptureSlot[]]))
  .max(WITHHOLDABLE_CAPTURE_SLOTS.length)
  .transform((v) => [...new Set(v)])
  .nullable();
