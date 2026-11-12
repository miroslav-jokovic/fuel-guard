import { z } from "zod";
import { DONOR_GENDERS } from "./applicantScreeningContract.js";
import { ENDORSEMENT_CODES } from "./rosterContract.js";

/**
 * `POST /api/recruitment/applications/:invitationId/part-one/answer` — the office correcting ONE of the
 * Part 1 answers the whole-set correction (`partOneCorrectionSchema`) does not carry (APPLICATION-FIX-PLAN
 * F3; the owner's Q-AM13 ruling, 2026-11-10: "we should be able to edit each answer because drivers make
 * mistakes"). The catalogue's `part_one_answer` door.
 *
 * ── WHY A SECOND SHAPE AND NOT FOUR MORE KEYS ON THE FIRST ────────────────────────────────────
 * The whole-set correction posts every field, required. Adding the drug-and-alcohol statements to it
 * would make every phone correction re-send the driver's §40.25(j) answer, and that answer needs a
 * reason each time it changes and none when it does not. One answer per call, through the same writer
 * (`record_applicant_intake`, overwriting just that key), keeps each correction its own act.
 *
 * ── THE NOTE ──────────────────────────────────────────────────────────────────────────────────
 * Required on exactly the catalogue's `rule: "statement"` facts — the four answers to questions the
 * regulation has the employer ASK (§40.25(j), §382.301(b)). It is the office's reason, kept on the edit
 * row (0586) and shown to the driver on 3.1 beside the change. The parity test holds the two lists
 * together ("requires a note on exactly the catalogue's statements").
 *
 * ⚠ `donor_gender` carries no note and is never read back: it is replace-only (the catalogue's
 * `replace_only`), so the office types a new answer blind and its edit row is withheld.
 */
const note = z
  .string()
  .trim()
  .min(1, "Say why you are changing the applicant's own answer — they will read this before they sign")
  .max(1000);

export const partOneAnswerSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("prior_positive_2y"), value: z.boolean(), note }).strict(),
  z.object({ key: z.literal("dot_program_30d"), value: z.boolean(), note }).strict(),
  z.object({ key: z.literal("dot_tested_6m"), value: z.boolean(), note }).strict(),
  z.object({ key: z.literal("dot_random_12m"), value: z.boolean(), note }).strict(),
  z.object({ key: z.literal("medical_card_pending"), value: z.boolean() }).strict(),
  z.object({ key: z.literal("donor_gender"), value: z.enum(DONOR_GENDERS) }).strict(),
  z.object({ key: z.literal("endorsements"), value: z.array(z.enum(ENDORSEMENT_CODES)).max(ENDORSEMENT_CODES.length) }).strict(),
]);
export type PartOneAnswer = z.infer<typeof partOneAnswerSchema>;
export type PartOneAnswerKey = PartOneAnswer["key"];

export const PART_ONE_ANSWER_KEYS = partOneAnswerSchema.options.map((o) => o.shape.key.value) as readonly PartOneAnswerKey[];

/**
 * What the office's review reads of these answers (F3). Booleans and codes; the donor gender as only
 * WHETHER it was given, never which (Q-AM13, D-MSUX10). Null on a legacy link, which has no Part 1.
 */
export interface PartOneAnswersView {
  dot_program_30d: boolean | null;
  dot_tested_6m: boolean | null;
  dot_random_12m: boolean | null;
  medical_card_pending: boolean;
  endorsements: string[];
  donorGenderGiven: boolean;
}
