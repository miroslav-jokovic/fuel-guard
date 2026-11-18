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
 *   format_not_built   an angle in a format this campaign cannot be made in — a dead angle a person would
 *                      approve. The caller says which formats those are (`planFormatsFor`): a format is built
 *                      when a worker can make it, and offered when this campaign has that worker's means.
 *   concept_not_available  an angle whose hook and scene no enabled preset of the carrier has. An ad is always
 *                      made from a preset (its copy slots, its picture, its layout), so such an angle could be
 *                      approved and then never made. Checked when the caller says which concepts exist.
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

/** The most items one pack holds. Our own rows come first; the swipe file's readings fill what room is left (V2r). */
export const EVIDENCE_PACK_MAX = 120;
export const evidencePackSchema = z.array(evidenceItemSchema).max(EVIDENCE_PACK_MAX)
  .refine((items) => new Set(items.map((e) => e.id)).size === items.length, { message: "evidence ids are unique" });
export type EvidencePack = z.infer<typeof evidencePackSchema>;

/**
 * Every format a plan may name, and which of them a worker can make today (V4, 2026-11-17: the motion ad's
 * whole road exists — clip, frame check, join, review player, publisher). BUILT is not OFFERED: see
 * `planFormatsFor`.
 */
export const PLAN_FORMATS = ["still", "motion", "driver_clip", "carousel"] as const;
export type PlanFormat = (typeof PLAN_FORMATS)[number];
export const PLAN_FORMATS_BUILT = ["still", "motion"] as const satisfies readonly PlanFormat[];
export type BuiltPlanFormat = (typeof PLAN_FORMATS_BUILT)[number];

/**
 * What each built format IS, as the Strategist's sheet says it (`planSheet`) — the same way a concept carries
 * `leads_with` and `picture`, so the prompt names no format of its own and cannot drift from this list. Each
 * sentence states what our renderer makes (`motionAd.ts`: the picture moves, the still's own words arrive in
 * groups, the last frame is the finished still, no sound — Q-APX13, Q-APX15), and holds no figure: the plan
 * may write none, and a number here would invite one.
 */
export const PLAN_FORMAT_MEANING: Record<BuiltPlanFormat, string> = {
  still: "one picture with the ad's words on it",
  motion: "the same ad as a short silent video: its picture moves for a few seconds while the same words arrive one group after another, and it ends held on the finished picture",
};

/** A format in office words, for the plan's review screen. */
export const PLAN_FORMAT_LABELS: Record<BuiltPlanFormat, string> = { still: "Still image", motion: "Short video" };

/**
 * The formats ONE campaign's plan may name: each built format whose means the campaign has. A still needs
 * nothing more; a motion ad needs a video model, and which model draws for a campaign follows its connection
 * (api `renderChoiceFor`) — none is chosen for a real connection until the owner's sitting (Q-APX12), so a real
 * campaign is offered `still` alone and a simulator campaign off production is offered both. This is the one
 * derivation: the Strategist's sheet, `checkPlan` at both of the store's doors and the editor all read its
 * answer, so what is offered, what is allowed and what `makeMotion` will make cannot differ.
 */
export function planFormatsFor(means: { videoModel: string | null }): BuiltPlanFormat[] {
  return PLAN_FORMATS_BUILT.filter((f) => f !== "motion" || means.videoModel !== null);
}

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
  | { kind: "concept_not_available"; where: string }
  | { kind: "claim"; where: string; finding: string; text: string };

/** An angle's concept as one comparable value — the same shape as a preset's (`conceptPair`). */
export const angleKind = (a: Pick<PlanAngle, "hook_family" | "scene_family">): string => `${a.hook_family}+${a.scene_family}`;

/** A kind of ad the carrier can make: the hook and scene of one of its enabled presets. */
export type PlanConcept = Pick<PlanAngle, "hook_family" | "scene_family">;

/** The distinct concepts among `presets`, in the order first met. A preset that names no concept offers none. */
export function distinctConcepts(presets: ReadonlyArray<{ hook_family?: string | null; scene_family?: string | null }>): PlanConcept[] {
  const seen = new Map<string, PlanConcept>();
  for (const p of presets) {
    const c = z.object({ hook_family: z.enum(AD_HOOK_FAMILIES), scene_family: z.enum(AD_SCENE_FAMILIES) }).safeParse(p);
    if (c.success && !seen.has(angleKind(c.data))) seen.set(angleKind(c.data), c.data);
  }
  return [...seen.values()];
}

/** What a campaign's plan may choose from: the formats it can be made in, and the kinds of ad its carrier's presets make. */
export interface PlanOffer {
  /** `planFormatsFor`'s answer for the campaign. */
  formats: readonly BuiltPlanFormat[];
  /** The hook and scene of each enabled preset (api `availableConcepts`). */
  concepts: readonly PlanConcept[];
}

/**
 * `offer.formats` is always asked: there is no list a caller may fall back on, because the answer differs by
 * campaign. `offer.concepts` — given, an angle outside them is a finding; absent, the question is not asked
 * (the contract's own tests, and a caller with no presets to read).
 */
export function checkPlan(plan: CampaignPlan, evidence: EvidencePack, brief: Pick<AdBrief, "claims">, offer: Pick<PlanOffer, "formats"> & Partial<Pick<PlanOffer, "concepts">>): PlanFinding[] {
  const { formats, concepts } = offer;
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
  const makeable = concepts ? new Set(concepts.map(angleKind)) : null;
  plan.angles.forEach((a, i) => {
    const where = `angle ${i + 1}`;
    cited(where, a.evidence);
    if (!a.evidence.some((id) => kindOf.get(id) === "job")) findings.push({ kind: "no_job_evidence", where });
    const kind = angleKind(a);
    const other = seen.get(kind);
    if (other) findings.push({ kind: "same_kind", where, other });
    else seen.set(kind, where);
    if (!(formats as readonly PlanFormat[]).includes(a.format)) findings.push({ kind: "format_not_built", where, format: a.format });
    if (makeable && !makeable.has(kind)) findings.push({ kind: "concept_not_available", where });
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

/**
 * What a writer is handed of the plan (V2c): the idea of the angle its preset was drawn for, and what of ours makes
 * it true. Nothing else of the angle goes — `why` argues to the person approving the plan and cites results a
 * writer has no use for. Both sentences already passed `checkPlan`'s claim check against the brief, so neither
 * holds a figure or a promise the copy may not state; they are direction all the same, never ad copy, and the
 * copy is still read by `checkClaims` whatever they say.
 */
export type WriterAngle = Pick<PlanAngle, "idea" | "proof">;

/**
 * The angle a preset's ad is made for: the plan's angle with the preset's hook and scene — the comparison
 * `planDraw` drew the preset by, read the other way, so the idea a creative is written from is the idea its
 * preset was chosen for. Null when the plan has no such angle (a preset version edited since the draw to
 * another concept, or one that names no concept — an angle always names both, so nothing matches it): the
 * writers then work from the preset alone, as an unplanned campaign's do.
 */
export function writerAngle(plan: Pick<CampaignPlan, "angles">, preset: { hook_family?: string | null; scene_family?: string | null }): WriterAngle | null {
  const angle = plan.angles.find((a) => a.hook_family === preset.hook_family && a.scene_family === preset.scene_family);
  return angle ? { idea: angle.idea, proof: angle.proof } : null;
}

/**
 * The format the plan chose for this preset's ad, found the way `writerAngle` finds its idea; null when the plan
 * has no such angle. Its own function and not a field of `WriterAngle`: that object is what the two writers are
 * handed, and a format is not theirs to read — it decides what is MADE from their work (V4), not what they write.
 */
export function angleFormat(plan: Pick<CampaignPlan, "angles">, preset: { hook_family?: string | null; scene_family?: string | null }): PlanFormat | null {
  return plan.angles.find((a) => a.hook_family === preset.hook_family && a.scene_family === preset.scene_family)?.format ?? null;
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

/**
 * `GET /api/ads/campaigns/:id/plan`: the newest version, or null when the campaign was never planned — and the
 * kinds of ad the carrier can make today and the formats this campaign can be made in, which is what an edit
 * may choose from (the door refuses any other).
 */
export interface AdsCampaignPlanRead {
  plan: AdsCampaignPlanView | null;
  concepts: PlanConcept[];
  /** The formats this campaign can be made in (`planFormatsFor`); an edit may choose among these. */
  formats: BuiltPlanFormat[];
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
    case "concept_not_available": return `${f.where} uses a hook and scene that is not one of the concepts on the sheet.`;
    case "claim": return `${f.where} says "${f.text}", which the job's facts do not hold (${f.finding}).`;
  }
}

/**
 * The presets a planned campaign's ads are made from, in the plan's order (V2c): for each angle, the enabled
 * preset with that hook and scene. It answers in the shape of the seeded draw (`presetDraw.ts`), so compose
 * reads one shape whichever road the campaign took; `seed` says which plan it came from.
 *
 * A preset a campaign for the same brief already runs is left out, as the seeded draw leaves it out (D-AD11:
 * the same concept twice for one opening competes with itself). Two presets with one concept cannot both be
 * enabled (`conceptPair`'s rule at save), so "the preset of an angle" is one preset; were there two, the first
 * by key is taken, so the answer does not depend on row order.
 */
export interface PlanDrawPreset { version_id: string; key: string; enabled: boolean; hook_family?: string | null; scene_family?: string | null }
export function planDraw(planId: string, plan: Pick<CampaignPlan, "angles">, presets: readonly PlanDrawPreset[], liveKeysForBrief: readonly string[]) {
  const live = new Set(liveKeysForBrief);
  const usable = [...presets].filter((p) => p.enabled).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const order: string[] = [];
  const excluded = new Set<string>();
  for (const a of plan.angles) {
    const preset = usable.find((p) => p.hook_family === a.hook_family && p.scene_family === a.scene_family);
    if (!preset) continue;
    if (live.has(preset.key)) excluded.add(preset.key);
    else if (!order.includes(preset.version_id)) order.push(preset.version_id);
  }
  return { seed: `plan:${planId}`, eligible: [...order].sort(), excluded_live: [...excluded].sort(), order, exhausted: order.length === 0 };
}
