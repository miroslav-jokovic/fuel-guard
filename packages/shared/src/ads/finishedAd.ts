import { z } from "zod";

/**
 * The finished-ad judge (ADS-CREATIVE-QUALITY-PLAN §7, P1-7; Q-AD76; audit AG5): Claude vision over the ad as a
 * driver will see it — the picture with our words drawn on it — scoring four things no earlier check looks at.
 * The copy check reads the words, the render check measures contrast, the visual check reads the bare picture;
 * none of them looks at the two TOGETHER, which is what a person in a feed sees.
 *
 * ── A SECOND OPINION, NEVER A GATE (Q-AD76, ruled 2026-11-10) ─────────────────────────────────────
 * The scores and their one-line reasons are stored under `checks.finished_ad` and shown beside the three checks,
 * labelled as an opinion. There is NO floor: a creative scored 1 everywhere still reaches review, and the person
 * decides. A floor is added only after these scores have been compared with the owner's approve/reject on 30
 * real ads — a threshold set before that would be a number somebody picked.
 *
 * Switched off, out of budget, or answering off-schema, the judge leaves `{ ran: false, not_run }` and the creative
 * goes to review anyway, saying the judge did not run and why.
 */

export const FINISHED_AD_CRITERIA = ["subject_legible", "words_match_picture", "hierarchy_reads", "looks_like_kit"] as const;
export type FinishedAdCriterion = (typeof FINISHED_AD_CRITERIA)[number];

/** What each criterion asks — the words the prompt and the review screen both use. */
export const FINISHED_AD_CRITERION_LABEL: Record<FinishedAdCriterion, string> = {
  subject_legible: "The one subject reads at a glance, at phone size",
  words_match_picture: "The words and the picture tell one story",
  hierarchy_reads: "The headline reads first, the button second, nothing competes",
  looks_like_kit: "It looks like this carrier: its colours, its logo",
};

/** One criterion's answer: the reason first (a judge that scores first reasons backwards), then 1–5. */
export const finishedAdItemSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  score: z.number().int().min(1).max(5),
}).strict();
export type FinishedAdItem = z.infer<typeof finishedAdItemSchema>;

export const finishedAdScoresSchema = z.object(
  Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, finishedAdItemSchema])) as Record<FinishedAdCriterion, typeof finishedAdItemSchema>,
).strict();
export type FinishedAdScores = z.infer<typeof finishedAdScoresSchema>;

/**
 * `checks.finished_ad` as compose writes it. Read leniently (as the rest of `checks` is) so a key added later does
 * not blank the review screen; `not_run` is the rail's word for why nothing was asked (`agent_off`, a budget
 * refusal, a failed or off-schema answer).
 */
export const finishedAdCheckSchema = z.looseObject({
  ran: z.boolean(),
  prompt_version: z.string().optional(),
  /** Per published format, the scores of the ENGLISH ad (the judge is asked once per format). */
  by_format: z.record(z.string(), z.looseObject(
    Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, z.looseObject({ score: z.number(), reason: z.string() })])),
  )).optional(),
  not_run: z.string().optional(),
});
export type FinishedAdCheck = z.infer<typeof finishedAdCheckSchema>;

export type FinishedAdOpinion =
  | { ran: false; why: string }
  | { ran: true; formats: Array<{ format: string; items: Array<{ criterion: FinishedAdCriterion; label: string; score: number; reason: string }> }> };

/** Why the judge did not run, in a reviewer's words. */
const NOT_RUN: Record<string, string> = {
  agent_off: "it is switched off in Ads control",
  budget_exhausted: "this month's model budget is spent",
  failed: "the call failed",
  off_schema: "its answer could not be read",
};

/** What the review screen shows, or null for a creative composed before the judge existed (it shows nothing). */
export function finishedAdOpinion(raw: unknown): FinishedAdOpinion | null {
  if (raw === undefined || raw === null) return null;
  const parsed = finishedAdCheckSchema.safeParse(raw);
  if (!parsed.success) return { ran: false, why: "its answer could not be read" };
  const c = parsed.data;
  if (!c.ran || !c.by_format) {
    // `failed (off_schema)` is an answer that could not be read, not a call that failed: say which.
    const code = /off_schema/.test(c.not_run ?? "") ? "off_schema" : (c.not_run ?? "").split(/[ (:]/)[0]!;
    return { ran: false, why: NOT_RUN[code] ?? (c.not_run || "it was not asked") };
  }
  return {
    ran: true,
    formats: Object.entries(c.by_format).map(([format, s]) => ({
      format,
      items: FINISHED_AD_CRITERIA.map((criterion) => {
        const item = (s as Record<string, { score: number; reason: string }>)[criterion];
        return { criterion, label: FINISHED_AD_CRITERION_LABEL[criterion], score: item?.score ?? 0, reason: item?.reason ?? "not answered" };
      }),
    })),
  };
}
