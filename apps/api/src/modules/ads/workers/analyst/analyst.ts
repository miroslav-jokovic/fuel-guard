import { readFileSync } from "node:fs";
import { z } from "zod";
import { AI_MODELS, briefFacts, checkNarration, type BriefFacts, type BriefFold, type NarrationFinding } from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";

/**
 * Analyst (ADS-AGENT-BUILD-WORKFLOW F1; plan D-AD5): the morning brief — a headline and a few points on
 * yesterday's campaigns, the month's spend and the lead cohorts — in words a busy office reads.
 *
 * ── THE FOLD COUNTS; THE MODEL ONLY NARRATES ──────────────────────────────────────────────────────
 * Every figure the model sees is on the fact sheet (`briefFacts`, shared `analystBrief.ts`), built from
 * `adsReport.ts`'s folds and formatted there; the model is shown no raw row and asked to compute
 * nothing. Its answer is then held to the sheet: every sentence goes through `checkNarration`, and ONE
 * number the sheet does not hold — a planted figure, a rounding, a rate for a young cohort, a number
 * written in words — refuses the whole brief. §4R's bar, "0 numbers in the narration that the fold did
 * not produce", is therefore absolute by construction, not a rate the model is trusted to reach: a
 * refused brief is never shown, and the next attempt is a new key the caller owns.
 *
 * The call goes through the A4 rail (`generateWithClaude`): the switch, the budget, the ledger row, the
 * replay. The key is the day and the attempt, so a re-run of the same morning asks no second model.
 */

export const ANALYST_PROMPT_VERSION = "analyst@2";
const PROMPT = readFileSync(new URL("./prompt.v2.md", import.meta.url), "utf8");
const MAX_TOKENS = 1200;

export interface BriefAnswer {
  headline: string;
  points: string[];
}

export const briefTool: ForcedTool<BriefAnswer> = {
  name: "write_brief",
  description: "Write the morning brief: one headline sentence and one to six points, every figure copied from the fact sheet.",
  schema: z.object({
    headline: z.string().trim().min(1).max(200),
    points: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
  }).strict(),
};

export function buildBriefRequest(fold: BriefFold) {
  return { model: AI_MODELS.deep, system: PROMPT, user: JSON.stringify(briefFacts(fold), null, 2), tool: briefTool, maxTokens: MAX_TOKENS };
}

/** Which sentence a finding is in: the headline, or a point by its index. */
export type BriefFinding = NarrationFinding & { where: "headline" | number };

export function judgeBrief(answer: BriefAnswer, facts: BriefFacts): BriefFinding[] {
  return [
    ...checkNarration(answer.headline, facts).map((f) => ({ ...f, where: "headline" as const })),
    ...answer.points.flatMap((p, i) => checkNarration(p, facts).map((f) => ({ ...f, where: i }))),
  ];
}

export interface WriteBriefInput {
  orgId: string;
  fold: BriefFold;
  /** 1 for the morning's first try; a refused brief's retry is attempt 2, a new key. */
  attempt: number;
}

export type WriteBriefOutcome =
  | { kind: "ready"; generationId: string; brief: BriefAnswer; replayed: boolean }
  | { kind: "refused"; generationId: string; findings: BriefFinding[]; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<BriefAnswer>, { kind: "succeeded" }>;

export async function writeBrief(deps: ClaudeGenerationDeps, input: WriteBriefInput): Promise<WriteBriefOutcome> {
  const out = await generateWithClaude(deps, {
    orgId: input.orgId,
    agent: "analyst",
    idempotencyKey: `brief:${input.fold.day}:${input.attempt}`,
    promptVersion: ANALYST_PROMPT_VERSION,
    ...buildBriefRequest(input.fold),
  });
  if (out.kind !== "succeeded") return out;
  const findings = judgeBrief(out.value, briefFacts(input.fold));
  return findings.length === 0
    ? { kind: "ready", generationId: out.generationId, brief: out.value, replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, findings, replayed: out.replayed };
}
