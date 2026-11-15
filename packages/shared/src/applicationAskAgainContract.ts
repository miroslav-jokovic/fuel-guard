import { z } from "zod";
import { APPLICANT_IDENTITY_KEYS } from "./applicantIdentity.js";
import { PART_ONE_COMPOSED_KEYS } from "./applicationComposition.js";
import { applicationPathSchema, type ApplicationPath } from "./applicationReviewContract.js";

/**
 * The office asks the driver one question again (APPLICATION-FIX-PLAN.md F5; migration 0607).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────────────────────
 * After the driver sends their application the office can correct an answer, and that is right for a
 * typo. For anything the office does not KNOW — a date, a reason, which of two jobs — correcting means
 * phoning the driver and typing their answer for them into a document they will sign. Asking puts the
 * question on the driver's own link and the answer in their own hands.
 *
 * ── WHAT MAY BE ASKED ─────────────────────────────────────────────────────────────────────────
 * An answer the driver can still change. Part 1's answers and the identity are frozen to the driver
 * once the first visit ends (0376, AI008): a question about one would open a screen that cannot save.
 * The office corrects those itself (`correctApplicantPartOne`, `correctApplicantIdentity`). Which keys
 * those are is read from where they are defined, never listed again here.
 *
 * ⚠ `addresses` is asked: only the CURRENT home's street is Part 1's, and every other row and both
 * dates of every row are the driver's own (`PART_ONE_STREET_KEYS`).
 */

/** Open questions one application may hold at once: more than a few is a conversation, and a phone call. */
export const ASK_AGAIN_MAX_OPEN = 5;
export const ASK_AGAIN_QUESTION_MAX = 500;

const NOT_THE_DRIVERS: ReadonlySet<string> = new Set<string>([
  ...PART_ONE_COMPOSED_KEYS.filter((k) => k !== "addresses"),
  ...APPLICANT_IDENTITY_KEYS,
]);

/** May the office ask the driver about this answer again? See the header for which it may not. */
export const canAskAgain = (path: ApplicationPath): boolean => !NOT_THE_DRIVERS.has(String(path[0]));

/** `POST /recruitment/applications/:invitationId/ask-again` — which answer, and the office's words. */
export const askAgainSchema = z
  .object({
    path: applicationPathSchema,
    question: z.string().trim().min(1, "Write the question for the applicant").max(ASK_AGAIN_QUESTION_MAX),
  })
  .strict();
export type AskAgain = z.infer<typeof askAgainSchema>;

/** One question, as the office's drawer and the driver's page both read it. Never who asked. */
export interface AskAgainView {
  id: string;
  path: ApplicationPath;
  question: string;
  askedAt: string;
  answeredAt: string | null;
  withdrawnAt: string | null;
}

export const askAgainIsOpen = (q: Pick<AskAgainView, "answeredAt" | "withdrawnAt">): boolean =>
  q.answeredAt === null && q.withdrawnAt === null;
