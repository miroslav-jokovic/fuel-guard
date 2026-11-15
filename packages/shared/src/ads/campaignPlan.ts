import { z } from "zod";
import { checkClaims } from "./adClaims.js";
import { AD_HOOK_FAMILIES, AD_SCENE_FAMILIES } from "./brandKitContract.js";
import type { AdBrief } from "./contracts.js";
import { recordId } from "../recordId.js";

/**
 * A campaign's plan, and the evidence it is written from (ADS-PLATFORM-V2-PLAN V2; owner 2026-11-14: "looks like
 * AI is in rush to create ad without any research"). Pure: no clock, no I/O.
 *
 * ── THE TWO HALVES ─────────────────────────────────────────────────────────────────────────────────────
 * EVIDENCE is built by code and never by a model: the job's own facts, our results per concept, why leads
 * were closed, the benchmark the settings cite, ads a recruiter saved, and what a reader found on approved
 * sites. Each item has an id.
 *
 * The PLAN is what the Strategist writes from it: who the ad speaks to, and several angles that differ in
 * kind. An angle names its hook and its scene from the two closed lists the presets already use
 * (`AD_HOOK_FAMILIES`, `AD_SCENE_FAMILIES`), so "differ in kind" is a comparison of two values and not a
 * judgement of two sentences.
 *
 * ── WHAT `checkPlan` HOLDS, AND WHY EACH ───────────────────────────────────────────────────────────────
 *   unknown_evidence   an id cited that the pack does not hold — the model invented its support.
 *   no_job_evidence    an angle that cites no fact of the job. An ad's facts come only from the brief
 *                      (D-AD1); an angle resting only on what others do has nothing of ours to say.
 *   same_kind          two angles with the same hook and scene: one concept twice, which Meta's delivery
 *                      collapses into one ad (ADS-CREATIVE-QUALITY-PLAN, the reason for D-AD29).
 *   format_not_built   an angle in a format no worker can make yet — a dead angle a person would approve.
 *   claim              a figure or a promise in the plan's own words that the brief does not hold, read by
 *                      the same `checkClaims` the copy is read by: a plan that says "$0.80 a mile" would
 *                      otherwise brief the copywriter to write it.
 * A plan with any finding is refused whole; nobody is shown a plan with a hole in it.
 */

export const PLAN_EVIDENCE_KINDS = ["job", "our_result", "lead_outcome", "benchmark", "swipe", "market"] as const;
export type PlanEvidenceKind = (typeof PLAN_EVIDENCE_KINDS)[number];

/** `<kind>:<slug>`, e.g. `job:claim_1`, `our_result:p2_cpl`. The kind in the id must be the item's kind. */
const EVIDENCE_ID = /^[a-z_]{2,20}:[a-z0-9][a-z0-9_-]{0,60}$/;

export const evidenceItemSchema = z.object({
  id: z.string().regex(EVIDENCE_ID),
  kind: z.enum(PLAN_EVIDENCE_KINDS),
  /** The fact, as a sentence a person can read. Never a lead's name, phone or e-mail (Q-APX2). */
  text: z.string().trim().min(3).max(400),
  /** Where it came from: a URL for `market` and `swipe`, null for what our own tables hold. */
  source: z.url({ protocol: /^https$/ }).nullable(),
}).refine((e) => e.id.startsWith(`${e.kind}:`), { message: "an evidence id starts with its kind", path: ["id"] });
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidencePackSchema = z.array(evidenceItemSchema).max(120)
  .refine((items) => new Set(items.map((e) => e.id)).size === items.length, { message: "evidence ids are unique" });
export type EvidencePack = z.infer<typeof evidencePackSchema>;

/** Every format a plan may name, and which a worker can make today: `still` only, until V4 builds video. */
export const PLAN_FORMATS = ["still", "motion", "driver_clip", "carousel"] as const;
export type PlanFormat = (typeof PLAN_FORMATS)[number];
export const PLAN_FORMATS_BUILT: readonly PlanFormat[] = ["still"];

export const PLAN_ANGLES_MIN = 3;
export const PLAN_ANGLES_MAX = 6;
const evidenceRefs = z.array(z.string().regex(EVIDENCE_ID)).min(1).max(6);

export const planAngleSchema = z.object({
  hook_family: z.enum(AD_HOOK_FAMILIES),
  scene_family: z.enum(AD_SCENE_FAMILIES),
  format: z.enum(PLAN_FORMATS),
  /** The idea in one sentence — what the ad leads with. Direction for the writers, never ad copy. */
  idea: z.string().trim().min(10).max(200),
  /** What of ours makes the idea true. */
  proof: z.string().trim().min(10).max(200),
  /** Why this angle, for this job, from this evidence. */
  why: z.string().trim().min(10).max(300),
  evidence: evidenceRefs,
});
export type PlanAngle = z.infer<typeof planAngleSchema>;

export const campaignPlanSchema = z.object({
  /** Who the ad speaks to, in plain words. `checkClaims` reads it, so an age, a sex or an origin is refused here as in copy. */
  audience: z.string().trim().min(20).max(400),
  audience_evidence: evidenceRefs,
  angles: z.array(planAngleSchema).min(PLAN_ANGLES_MIN).max(PLAN_ANGLES_MAX),
});
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;

export type PlanFinding =
  | { kind: "unknown_evidence"; where: string; id: string }
  | { kind: "no_job_evidence"; where: string }
  | { kind: "same_kind"; where: string; other: string }
  | { kind: "format_not_built"; where: string; format: PlanFormat }
  | { kind: "claim"; where: string; finding: string; text: string };

/** An angle's concept as one comparable value — the same shape as a preset's (`conceptPair`). */
export const angleKind = (a: Pick<PlanAngle, "hook_family" | "scene_family">): string => `${a.hook_family}+${a.scene_family}`;

export function checkPlan(plan: CampaignPlan, evidence: EvidencePack, brief: Pick<AdBrief, "claims">): PlanFinding[] {
  const findings: PlanFinding[] = [];
  const kindOf = new Map(evidence.map((e) => [e.id, e.kind]));
  const cited = (where: string, ids: readonly string[]) => {
    for (const id of ids) if (!kindOf.has(id)) findings.push({ kind: "unknown_evidence", where, id });
  };
  const claims = (where: string, text: string) => {
    for (const f of checkClaims(text, brief).findings) findings.push({ kind: "claim", where, finding: f.kind, text: f.text });
  };

  cited("audience", plan.audience_evidence);
  claims("audience", plan.audience);

  const seen = new Map<string, string>();
  plan.angles.forEach((a, i) => {
    const where = `angle ${i + 1}`;
    cited(where, a.evidence);
    if (!a.evidence.some((id) => kindOf.get(id) === "job")) findings.push({ kind: "no_job_evidence", where });
    const kind = angleKind(a);
    const other = seen.get(kind);
    if (other) findings.push({ kind: "same_kind", where, other });
    else seen.set(kind, where);
    if (!PLAN_FORMATS_BUILT.includes(a.format)) findings.push({ kind: "format_not_built", where, format: a.format });
    for (const part of ["idea", "proof", "why"] as const) claims(`${where} ${part}`, a[part]);
  });
  return findings;
}

/** The job's own facts as evidence items: one per claim and one per detail, ids stable for the same brief. */
export function jobEvidence(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">): EvidenceItem[] {
  const items: EvidenceItem[] = [{ id: "job:subject", kind: "job", text: `The job: ${brief.subject}.`, source: null }];
  brief.claims.forEach((c, i) => {
    const text =
      c.kind === "money" ? `The opening pays $${(c.cents / 100).toFixed(c.cents % 100 === 0 ? 0 : 2)}${c.per ? ` per ${c.per}` : ""}.`
      : c.kind === "quantity" ? `The opening states ${c.value} ${c.unit}${c.value === 1 ? "" : "s"}.`
      : `The opening offers: ${c.term}.`;
    items.push({ id: `job:claim_${i + 1}`, kind: "job", text, source: null });
  });
  brief.subject_matter.details.forEach((d, i) => items.push({ id: `job:detail_${i + 1}`, kind: "job", text: d, source: null }));
  if (brief.subject_matter.in_our_words) items.push({ id: "job:in_our_words", kind: "job", text: brief.subject_matter.in_our_words, source: null });
  return items;
}

// ── the doors a person uses (V2c): read the plan, save an edit, approve a version ────────────────────────
/** A plan version as the review screen reads it. `author_name` is null for the Strategist's. */
export interface AdsCampaignPlanView {
  id: string;
  version: number;
  plan: CampaignPlan;
  evidence: EvidencePack;
  author_kind: "agent" | "person";
  author_name: string | null;
  created_at: string;
}

/** `GET /api/ads/campaigns/:id/plan`: the newest version, or null when the campaign was never planned. */
export interface AdsCampaignPlanRead {
  plan: AdsCampaignPlanView | null;
}

/** A person's edit: the whole plan, and the version they had open — the save is refused if the plan moved since. */
export const adsPlanEditSchema = z.object({ based_on_version: z.number().int().min(1), plan: campaignPlanSchema });
export type AdsPlanEdit = z.infer<typeof adsPlanEditSchema>;

/** Approval names the version by id (AX032): the campaign composes from exactly the plan the person read. */
export const adsPlanApprovalSchema = z.object({ plan_id: recordId() });
export type AdsPlanApproval = z.infer<typeof adsPlanApprovalSchema>;

/** A finding as a sentence for the person who edited the plan — the same facts the Strategist is told. */
export function planFindingWords(f: PlanFinding): string {
  switch (f.kind) {
    case "unknown_evidence": return `${f.where} cites ${f.id}, which is not on the sheet.`;
    case "no_job_evidence": return `${f.where} cites no job item.`;
    case "same_kind": return `${f.where} uses the same hook and scene as ${f.other}.`;
    case "format_not_built": return `${f.where} is in the format ${f.format}, which is not in formats_available.`;
    case "claim": return `${f.where} says "${f.text}", which the job's facts do not hold (${f.finding}).`;
  }
}
