import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  AD_AGENT_MODELS, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILY_LABELS, PLAN_ANGLES_MAX, PLAN_ANGLES_MIN, PLAN_FORMATS_BUILT, PLAN_FORMAT_MEANING,
  campaignPlanSchema, checkPlan, distinctConcepts, evidencePackSchema, planFindingWords, type AdBrief, type CampaignPlan, type EvidencePack, type PlanFinding, type PlanOffer,
} from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";
import { generationByKey } from "../../generations/generationLedger.js";

/**
 * The Strategist (ADS-PLATFORM-V2-PLAN V2c; owner 2026-11-14: "looks like AI is in rush to create ad without
 * any research"): from the evidence pack, who the ad speaks to and several angles that differ in kind — the
 * plan a person approves before anything is written or drawn.
 *
 * ── CODE GATHERS; THE MODEL ONLY PLANS; CODE CHECKS ────────────────────────────────────────────────────
 * Every fact the model sees is an item of the pack (`plan/evidencePack.ts`), and it is told the two lists an
 * angle chooses from — the concepts the carrier's enabled presets can make, each with what it means
 * (`planSheet`) — so the prompt names no hook, scene or format of its own and cannot drift from the contract.
 * An ad is always made from a preset, so an angle outside those concepts could be approved and never made. Its answer goes through `checkPlan` (shared): an id the
 * pack does not hold, an angle citing no fact of the job, one concept twice, a format nobody can make, a figure
 * or a promise the opening does not hold. Any finding and the plan is refused whole.
 *
 * ── ONE SECOND ASK, WITH THE FINDINGS IN FRONT OF IT ───────────────────────────────────────────────────
 * A refused plan is asked for once more (`attempt` 2, its own key), with the refused plan and each finding in
 * words on the sheet — the Copywriter's fit pass (CQ2) is the precedent. Repeating the same request would
 * mostly repeat the same fault. A second refusal is the planner's failure, with the reason.
 *
 * ── A REPLAYED ANSWER IS CHECKED AGAINST THE PACK IT WAS WRITTEN FROM ──────────────────────────────────
 * The planning step can run twice, and the pack and the concepts are read from live tables: the second run
 * may find an hour, a lead or a preset the first did not. The model's answer replays under its key, so on a replay the pack is read
 * back from the ledger row's own request — the sheet that was actually sent — never from today's tables. The
 * plan's row then keeps the evidence its ids were chosen from, which is what 0606 says the column is.
 *
 * strategist@2 (2026-11-15, the day of @1): @1 scored 8 of 8 and then 7 of 8. The recorded plans ran at the
 * contract's limits (an audience of 385 characters against 400, a `why` of 290 against 300, six ids against
 * six), so one run in a few put a text over and the whole answer was `off_schema`, which has no second ask.
 * @2 states tighter lengths in the prompt. The contract's limits did not move: they are what a person reads.
 *
 * strategist@3 (2026-11-15): the sheet offers CONCEPTS — the hook and scene pairs the carrier's enabled presets
 * can make — in place of the two free lists, and an angle outside them is refused. @2 could propose any of
 * twenty-five pairs to a carrier whose presets make five, so an approved angle could have no ad.
 *
 * strategist@4 (2026-11-17, V4): the sheet's `formats_available` is the list for THIS campaign
 * (`planFormatsFor`), each format with what it is — until now it was one constant and the only entry was a
 * still. The prompt says how to choose where there are several, from what the sheet says and nothing of its
 * own: no page we have read measures a moving ad against a still one for a driver lead ad, and the evidence
 * pack holds no result by format yet, so the prompt forbids the claim and asks the plan to say that nothing
 * was measured. "At least one angle stays in the first format" is OURS, not a published rule: a plan that is
 * all video cannot be compared with anything and costs a clip per ad.
 */
export const STRATEGIST_PROMPT_VERSION = "strategist@4";
const PROMPT = readFileSync(new URL("./prompt.v4.md", import.meta.url), "utf8");
// A plan is at most six angles of three short texts each; the rest is the model's thinking (`wireShape` adds its headroom).
const MAX_TOKENS = 4000;

export const planTool: ForcedTool<CampaignPlan> = {
  name: "write_plan",
  description: "Write the campaign plan: who the ads speak to, and the angles, each citing evidence ids from the sheet.",
  schema: campaignPlanSchema,
};

/** What the second ask is shown: the plan that was refused and why, each finding as a sentence. */
export interface PlanRevision {
  plan: CampaignPlan;
  findings: PlanFinding[];
}

/** One definition, shared with the edit door's refusal (`planFindingWords`): the model and a person are told the same thing. */
export const findingWords = planFindingWords;

/** The sheet the model reads. `evidence` is the pack whole, so the ledger's copy of this request restores it. */
export function planSheet(evidence: EvidencePack, offer: PlanOffer, revise?: PlanRevision) {
  return {
    evidence,
    // The kinds of ad this carrier can make, each with what it means. An angle is one of these and nothing else.
    concepts: offer.concepts.map((c) => ({ ...c, leads_with: AD_HOOK_FAMILY_LABELS[c.hook_family], picture: AD_SCENE_FAMILY_LABELS[c.scene_family] })),
    // The formats THIS campaign can be made in (`planFormatsFor`), each with what it is: `motion` is here only when it has a video model.
    formats_available: offer.formats.map((format) => ({ format, is: PLAN_FORMAT_MEANING[format] })),
    angles: { min: PLAN_ANGLES_MIN, max: PLAN_ANGLES_MAX },
    ...(revise ? { refused_plan: revise.plan, refused_because: revise.findings.map(findingWords) } : {}),
  };
}

export function buildPlanRequest(evidence: EvidencePack, offer: PlanOffer, revise?: PlanRevision) {
  return { ...AD_AGENT_MODELS.strategist, system: PROMPT, user: JSON.stringify(planSheet(evidence, offer, revise), null, 2), tool: planTool, maxTokens: MAX_TOKENS };
}

export const judgePlan = (plan: CampaignPlan, evidence: EvidencePack, brief: Pick<AdBrief, "claims">, offer: PlanOffer): PlanFinding[] => checkPlan(plan, evidence, brief, offer);

export interface WritePlanInput {
  orgId: string;
  campaignId: string;
  /** The planning stint (`<campaign id>:<state_changed_at>`), so a `replan` asks anew and a re-run replays. */
  stint: string;
  /** 1 = the stint's first ask; 2 = the one ask after a refusal, with `revise`. */
  attempt: 1 | 2;
  evidence: EvidencePack;
  /** The kinds of ad the carrier can make today and the formats this campaign can be made in (`plan/concepts.ts`). */
  offer: PlanOffer;
  brief: Pick<AdBrief, "claims">;
  revise?: PlanRevision;
}

export type WritePlanOutcome =
  | { kind: "ready"; generationId: string; plan: CampaignPlan; evidence: EvidencePack; offer: PlanOffer; replayed: boolean }
  | { kind: "refused"; generationId: string; plan: CampaignPlan; findings: PlanFinding[]; evidence: EvidencePack; offer: PlanOffer; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<CampaignPlan>, { kind: "succeeded" }>;

export const planKey = (stint: string, attempt: number): string => `plan:${stint}:${attempt}`;

export async function writePlan(deps: ClaudeGenerationDeps, input: WritePlanInput): Promise<WritePlanOutcome> {
  const idempotencyKey = planKey(input.stint, input.attempt);
  const out = await generateWithClaude(deps, {
    orgId: input.orgId, agent: "strategist", campaignId: input.campaignId, idempotencyKey,
    promptVersion: STRATEGIST_PROMPT_VERSION, ...buildPlanRequest(input.evidence, input.offer, input.revise),
  });
  if (out.kind !== "succeeded") return out;
  const { evidence, offer } = out.replayed ? await sentSheet(deps, input.orgId, idempotencyKey) : { evidence: input.evidence, offer: input.offer };
  const findings = judgePlan(out.value, evidence, input.brief, offer);
  return findings.length === 0
    ? { kind: "ready", generationId: out.generationId, plan: out.value, evidence, offer, replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, plan: out.value, findings, evidence, offer, replayed: out.replayed };
}

const sentFormats = z.array(z.object({ format: z.enum(PLAN_FORMATS_BUILT) })).min(1);

/**
 * The pack, the concepts and the formats on the sheet a stored answer was written from, read back from its
 * ledger row. The formats too: a connection's video model can be chosen between two runs of one stint, and an
 * answer is held to what the model was offered, never to what is on offer now.
 */
async function sentSheet(deps: ClaudeGenerationDeps, orgId: string, key: string): Promise<{ evidence: EvidencePack; offer: PlanOffer }> {
  const row = await generationByKey(deps.admin, orgId, key);
  const user = (row?.request as { user?: unknown } | undefined)?.user;
  let sheet: unknown;
  try { sheet = typeof user === "string" ? JSON.parse(user) : null; } catch { sheet = null; }
  const pack = evidencePackSchema.safeParse((sheet as { evidence?: unknown } | null)?.evidence);
  if (!pack.success) throw new Error(`ad_generations: the request stored under ${key} holds no evidence pack`);
  const formats = sentFormats.safeParse((sheet as { formats_available?: unknown }).formats_available);
  if (!formats.success) throw new Error(`ad_generations: the request stored under ${key} holds no formats_available`);
  return { evidence: pack.data, offer: { formats: formats.data.map((f) => f.format), concepts: distinctConcepts(((sheet as { concepts?: unknown }).concepts ?? []) as Array<Record<string, string>>) } };
}
