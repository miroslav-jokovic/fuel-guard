import { readFileSync } from "node:fs";
import {
  AD_AGENT_MODELS, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILY_LABELS, PLAN_ANGLES_MAX, PLAN_ANGLES_MIN, PLAN_FORMATS_BUILT,
  campaignPlanSchema, checkPlan, evidencePackSchema, type AdBrief, type CampaignPlan, type EvidencePack, type PlanFinding,
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
 * angle chooses from by reading them off the contract (`planSheet`) — the prompt names no hook, scene or
 * format of its own, so the lists cannot drift from it. Its answer goes through `checkPlan` (shared): an id the
 * pack does not hold, an angle citing no fact of the job, one concept twice, a format nobody can make, a figure
 * or a promise the opening does not hold. Any finding and the plan is refused whole.
 *
 * ── ONE SECOND ASK, WITH THE FINDINGS IN FRONT OF IT ───────────────────────────────────────────────────
 * A refused plan is asked for once more (`attempt` 2, its own key), with the refused plan and each finding in
 * words on the sheet — the Copywriter's fit pass (CQ2) is the precedent. Repeating the same request would
 * mostly repeat the same fault. A second refusal is the planner's failure, with the reason.
 *
 * ── A REPLAYED ANSWER IS CHECKED AGAINST THE PACK IT WAS WRITTEN FROM ──────────────────────────────────
 * The planning step can run twice, and the pack is read from live tables: the second run's pack may hold an
 * hour or a lead the first did not. The model's answer replays under its key, so on a replay the pack is read
 * back from the ledger row's own request — the sheet that was actually sent — never from today's tables. The
 * plan's row then keeps the evidence its ids were chosen from, which is what 0606 says the column is.
 *
 * strategist@2 (2026-11-15, the day of @1): @1 scored 8 of 8 and then 7 of 8. The recorded plans ran at the
 * contract's limits (an audience of 385 characters against 400, a `why` of 290 against 300, six ids against
 * six), so one run in a few put a text over and the whole answer was `off_schema`, which has no second ask.
 * @2 states tighter lengths in the prompt. The contract's limits did not move: they are what a person reads.
 */
export const STRATEGIST_PROMPT_VERSION = "strategist@2";
const PROMPT = readFileSync(new URL("./prompt.v2.md", import.meta.url), "utf8");
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

export function findingWords(f: PlanFinding): string {
  switch (f.kind) {
    case "unknown_evidence": return `${f.where} cites ${f.id}, which is not on the sheet.`;
    case "no_job_evidence": return `${f.where} cites no job item.`;
    case "same_kind": return `${f.where} uses the same hook and scene as ${f.other}.`;
    case "format_not_built": return `${f.where} is in the format ${f.format}, which is not in formats_available.`;
    case "claim": return `${f.where} says "${f.text}", which the job's facts do not hold (${f.finding}).`;
  }
}

/** The sheet the model reads. `evidence` is the pack whole, so the ledger's copy of this request restores it. */
export function planSheet(evidence: EvidencePack, revise?: PlanRevision) {
  return {
    evidence,
    hook_families: AD_HOOK_FAMILY_LABELS,
    scene_families: AD_SCENE_FAMILY_LABELS,
    formats_available: PLAN_FORMATS_BUILT,
    angles: { min: PLAN_ANGLES_MIN, max: PLAN_ANGLES_MAX },
    ...(revise ? { refused_plan: revise.plan, refused_because: revise.findings.map(findingWords) } : {}),
  };
}

export function buildPlanRequest(evidence: EvidencePack, revise?: PlanRevision) {
  return { ...AD_AGENT_MODELS.strategist, system: PROMPT, user: JSON.stringify(planSheet(evidence, revise), null, 2), tool: planTool, maxTokens: MAX_TOKENS };
}

export const judgePlan = (plan: CampaignPlan, evidence: EvidencePack, brief: Pick<AdBrief, "claims">): PlanFinding[] => checkPlan(plan, evidence, brief);

export interface WritePlanInput {
  orgId: string;
  campaignId: string;
  /** The planning stint (`<campaign id>:<state_changed_at>`), so a `replan` asks anew and a re-run replays. */
  stint: string;
  /** 1 = the stint's first ask; 2 = the one ask after a refusal, with `revise`. */
  attempt: 1 | 2;
  evidence: EvidencePack;
  brief: Pick<AdBrief, "claims">;
  revise?: PlanRevision;
}

export type WritePlanOutcome =
  | { kind: "ready"; generationId: string; plan: CampaignPlan; evidence: EvidencePack; replayed: boolean }
  | { kind: "refused"; generationId: string; plan: CampaignPlan; findings: PlanFinding[]; evidence: EvidencePack; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<CampaignPlan>, { kind: "succeeded" }>;

export const planKey = (stint: string, attempt: number): string => `plan:${stint}:${attempt}`;

export async function writePlan(deps: ClaudeGenerationDeps, input: WritePlanInput): Promise<WritePlanOutcome> {
  const idempotencyKey = planKey(input.stint, input.attempt);
  const out = await generateWithClaude(deps, {
    orgId: input.orgId, agent: "strategist", campaignId: input.campaignId, idempotencyKey,
    promptVersion: STRATEGIST_PROMPT_VERSION, ...buildPlanRequest(input.evidence, input.revise),
  });
  if (out.kind !== "succeeded") return out;
  const evidence = out.replayed ? await sentEvidence(deps, input.orgId, idempotencyKey) : input.evidence;
  const findings = judgePlan(out.value, evidence, input.brief);
  return findings.length === 0
    ? { kind: "ready", generationId: out.generationId, plan: out.value, evidence, replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, plan: out.value, findings, evidence, replayed: out.replayed };
}

/** The pack on the sheet a stored answer was written from, read back from its ledger row. */
async function sentEvidence(deps: ClaudeGenerationDeps, orgId: string, key: string): Promise<EvidencePack> {
  const row = await generationByKey(deps.admin, orgId, key);
  const user = (row?.request as { user?: unknown } | undefined)?.user;
  let sheet: unknown;
  try { sheet = typeof user === "string" ? JSON.parse(user) : null; } catch { sheet = null; }
  const pack = evidencePackSchema.safeParse((sheet as { evidence?: unknown } | null)?.evidence);
  if (!pack.success) throw new Error(`ad_generations: the request stored under ${key} holds no evidence pack`);
  return pack.data;
}
