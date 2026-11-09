import { z } from "zod";

/**
 * Copy candidates and the craft judge's ranking (ADS-CREATIVE-QUALITY-PLAN CQ4; D-AD19, D-AD21; column 0579
 * `ads_creatives.candidates`). The Copywriter now offers `k` candidates for one creative; every one goes through the
 * claim and length checks exactly as one copy did (D-AD1 is absolute); the survivors are ranked here, by the craft
 * judge's scores, and the first becomes the creative's `copy`. The whole ranked set, scores and reasons included, is
 * stored, so the review screen can say why this one and a person can disagree.
 *
 * ── WHAT THE JUDGE SCORES, AND WHAT IT DOES NOT ──────────────────────────────────────────────────
 * Five criteria, each 1–5 with a reason, chosen from what research on ad copy and on LLM judges agrees on (plan §1
 * R7): the judgment is decomposed into concrete criteria with the reason written BEFORE the score. It never scores
 * truth — the claim check already refused every untrue candidate — and it never approves: the human does (D-AD12).
 * Its own baseline is the planted-filler set (a candidate written as any carrier's ad must rank last) until the
 * owner's ratings of real copy exist (Q-AD57); the threshold at which a judge is trusted to ORDER is that ruling's.
 *
 * ── RANKING IS PURE AND TOTAL-ORDERED ────────────────────────────────────────────────────────────
 * `rankCandidates` sums the five scores; a tie keeps the model's own order (the first offered first). A candidate the
 * judge did not score (the judge switched off, out of budget, or an answer the schema refused) ranks after every
 * scored one in its original order — and when NONE is scored the order is the Copywriter's, recorded as such
 * (`judge: null`), which is exactly what every creative was before CQ4.
 */

export const CRAFT_CRITERIA = ["hook", "specific", "plain", "spanish", "no_filler"] as const;
export type CraftCriterion = (typeof CRAFT_CRITERIA)[number];

/** What each criterion asks, in the words the judge's prompt and the review screen both use. */
export const CRAFT_CRITERION_LABEL: Record<CraftCriterion, string> = {
  hook: "Leads with what the concept says to lead with, and says it first",
  specific: "Specific to this job — equipment, lanes, schedule, the carrier — not any job",
  plain: "Plain sentences a dispatcher would say; no brochure voice",
  spanish: "Spanish written for a Spanish-speaking US driver, with the trade's words",
  no_filler: "No filler a driver cannot check (exciting opportunity, competitive pay, dynamic team)",
};

const score = z.number().int().min(1).max(5);

/** The judge's answer for one candidate: a reason first, then the five scores. */
export const craftScoreSchema = z.object({
  reason: z.string().trim().min(1).max(600),
  scores: z.object(Object.fromEntries(CRAFT_CRITERIA.map((c) => [c, score])) as Record<CraftCriterion, typeof score>).strict(),
}).strict();
export type CraftScore = z.infer<typeof craftScoreSchema>;

export const CRAFT_MAX_TOTAL = CRAFT_CRITERIA.length * 5;
export const craftTotal = (s: CraftScore): number => CRAFT_CRITERIA.reduce((n, c) => n + s.scores[c], 0);

/** One language's slots, as the Copywriter writes them. */
const slots = z.record(z.string(), z.string());

export const adCandidateSchema = z.object({
  copy: z.object({ en: slots, es: slots }).strict(),
  /** Null when the judge did not score this candidate. */
  judged: craftScoreSchema.nullable(),
  /** The sum of the five scores, or null when unjudged; kept so a reader needs no arithmetic. */
  total: z.number().int().min(CRAFT_CRITERIA.length).max(CRAFT_MAX_TOTAL).nullable(),
  /** The candidate's index in the Copywriter's own order (0-based), so "the model's first" is still known. */
  offered_as: z.number().int().min(0),
});
export type AdCandidate = z.infer<typeof adCandidateSchema>;

/** `ads_creatives.candidates` (0579): the ranked set, which one became `copy`, and who ranked it. */
export const adCandidatesSchema = z.object({
  ranked: z.array(adCandidateSchema).min(1).max(5),
  /** The index into `ranked` that became `copy`; 0 unless a person picks another (CQ4c). */
  chosen: z.number().int().min(0),
  /** The judge's prompt version, or null when no candidate was judged and the order is the Copywriter's. */
  judge: z.string().nullable(),
  /** How many the Copywriter offered and how many the claim and length checks let through. */
  offered: z.number().int().min(1).max(5),
  passed: z.number().int().min(1).max(5),
}).strict().refine((c) => c.chosen < c.ranked.length, "chosen names a candidate that is not in the list");
export type AdCandidates = z.infer<typeof adCandidatesSchema>;

export interface Offered<C> {
  copy: C;
  /** The judge's score for this candidate, or null (unjudged). */
  judged: CraftScore | null;
  offered_as: number;
}

/**
 * The survivors in rank order: judged ones by total, high first, ties by the model's order; unjudged ones after,
 * in the model's order. Pure.
 */
export function rankCandidates<C>(offered: readonly Offered<C>[]): Array<Offered<C> & { total: number | null }> {
  const withTotals = offered.map((o) => ({ ...o, total: o.judged ? craftTotal(o.judged) : null }));
  return [...withTotals].sort((a, b) => {
    if (a.total === null && b.total === null) return a.offered_as - b.offered_as;
    if (a.total === null) return 1;
    if (b.total === null) return -1;
    return b.total - a.total || a.offered_as - b.offered_as;
  });
}
