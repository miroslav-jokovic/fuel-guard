import { AI_MODELS, type AiEffort } from "../ai.js";
import type { AdAiAgent } from "./contracts.js";

/**
 * Which model each ads agent asks, and how hard (ADS-PLATFORM-V2-PLAN V1, owner 2026-11-14: "maybe we are
 * using Opus 5.5 for some ads agents … Sonnet 4.6 is not really optimized for this work").
 *
 * One line per agent, so moving one agent is one line and one recording — never a side effect of moving
 * another. EVERY agent still names `AI_MODELS.deep` today, on purpose: a line changes only in the PR that
 * re-records that agent's fixtures on the new model (`pnpm ads:eval <worker> --record`, on the owner's key,
 * asked for first) and shows its baseline met or beaten. `workers/agentModels.test.ts` fails a line whose
 * model is not the one that worker's `baseline.json` was recorded on.
 *
 * `renderer` asks no Claude model (its provider is Higgsfield); it is in `AD_AI_AGENTS` for the switch and
 * the ledger, so it has no line.
 */
export type AdClaudeAgent = Exclude<AdAiAgent, "renderer">;

export interface AdAgentModel {
  model: string;
  /** Absent = the model's own default; nothing is sent. */
  effort?: AiEffort;
}

export const AD_AGENT_MODELS: Readonly<Record<AdClaudeAgent, AdAgentModel>> = {
  copywriter: { model: AI_MODELS.deep },
  art_director: { model: AI_MODELS.deep },
  checker: { model: AI_MODELS.deep },
  analyst: { model: AI_MODELS.deep },
  craft_judge: { model: AI_MODELS.deep },
  finished_ad_judge: { model: AI_MODELS.deep },
};
