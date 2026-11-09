import { readFileSync } from "node:fs";
import { z } from "zod";
import { AI_MODELS, CRAFT_CRITERIA, craftScoreSchema, fnv1a32, type AdBrief, type AdPresetRecipe, type CraftScore } from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";
import { copyUserMessage, type AdCopy, type CopyContext } from "../copywriter/copywriter.js";

/**
 * The craft judge (ADS-CREATIVE-QUALITY-PLAN CQ4; D-AD21): scores the Copywriter's surviving candidates on five
 * criteria (`CRAFT_CRITERIA`, shared) with a reason written before each score, so `rankCandidates` can order them
 * and the review screen can say why. It judges craft only — every candidate it sees has already passed the claim
 * and length checks — and it never approves: the person does (D-AD12).
 *
 * ── POSITION BIAS IS DESIGNED OUT, NOT HOPED AWAY ────────────────────────────────────────────────
 * LLM judges favour the first (and sometimes the last) item they read (plan §1 R7: "position randomization …
 * reduce bias"). The candidates are shown in an order drawn from the creative's id (`presentationOrder`, a seeded
 * Fisher–Yates), the tool answers in that order, and the scores are mapped back. The same creative always shows
 * the same order, so a replay judges what the ledger row judged.
 *
 * Through the A4 rail as every worker: switch, budget, ledger, replay. `buildJudgeRequest` and `judgeAnswer` are
 * exported so `pnpm ads:eval craftJudge` asks and reads exactly as the worker does.
 */

export const CRAFT_JUDGE_PROMPT_VERSION = "craftJudge@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
const MAX_TOKENS = 3000;

export interface JudgeAnswer { scores: CraftScore[] }

export function judgeTool(n: number): ForcedTool<JudgeAnswer> {
  return {
    name: "judge_copy",
    description: `Score each of the ${n} candidates, in the order given: a reason first, then five whole-number scores from 1 to 5.`,
    schema: z.object({ scores: z.array(craftScoreSchema).length(n) }).strict() as unknown as z.ZodType<JudgeAnswer>,
  };
}

/** mulberry32 over the seed's FNV-1a hash — the same PRNG `presetDraw.ts` uses, for the same reason: reproducible. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The order the judge sees the candidates in: `presented[i]` is the index, in the Copywriter's order, shown at position i. */
export function presentationOrder(seed: string, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const next = mulberry32(fnv1a32(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function judgeUserMessage(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">, recipe: AdPresetRecipe, candidates: readonly AdCopy[], ctx: CopyContext, presented: readonly number[]): string {
  const base = JSON.parse(copyUserMessage(brief, recipe, ctx)) as Record<string, unknown>;
  delete base.candidates;
  return JSON.stringify({ ...base, candidates: presented.map((i) => candidates[i]!) }, null, 2);
}

export function buildJudgeRequest(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">, recipe: AdPresetRecipe, candidates: readonly AdCopy[], ctx: CopyContext, presented: readonly number[]) {
  return { model: AI_MODELS.deep, system: PROMPT, user: judgeUserMessage(brief, recipe, candidates, ctx, presented), tool: judgeTool(candidates.length), maxTokens: MAX_TOKENS };
}

/** The scores back in the Copywriter's order: `scores[k]` is the score of candidate k. */
export function judgeAnswer(answer: JudgeAnswer, presented: readonly number[]): CraftScore[] {
  const out: CraftScore[] = new Array(presented.length);
  presented.forEach((candidateIndex, position) => { out[candidateIndex] = answer.scores[position]!; });
  return out;
}

export interface JudgeCraftInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  attempt: number;
  brief: AdBrief;
  recipe: AdPresetRecipe;
  candidates: readonly AdCopy[];
  company_name?: string | null;
}

export type JudgeCraftOutcome =
  | { kind: "ready"; generationId: string; scores: CraftScore[]; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<JudgeAnswer>, { kind: "succeeded" }>;

export async function judgeCraft(deps: ClaudeGenerationDeps, input: JudgeCraftInput): Promise<JudgeCraftOutcome> {
  const presented = presentationOrder(input.creativeId, input.candidates.length);
  const out = await generateWithClaude(deps, {
    orgId: input.orgId, agent: "craft_judge", campaignId: input.campaignId, creativeId: input.creativeId,
    idempotencyKey: `judge:${input.creativeId}:${input.attempt}`, promptVersion: CRAFT_JUDGE_PROMPT_VERSION,
    ...buildJudgeRequest(input.brief, input.recipe, input.candidates, { company_name: input.company_name ?? null }, presented),
  });
  if (out.kind !== "succeeded") return out;
  return { kind: "ready", generationId: out.generationId, scores: judgeAnswer(out.value, presented), replayed: out.replayed };
}

/** For a reader: the criteria in the order the prompt names them. */
export const CRITERIA_IN_PROMPT_ORDER = CRAFT_CRITERIA;
