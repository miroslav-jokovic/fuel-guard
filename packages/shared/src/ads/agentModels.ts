import type { AiEffort } from "../ai.js";
import type { AdAiAgent } from "./contracts.js";

/**
 * Which model each ads agent asks, and how hard (ADS-PLATFORM-V2-PLAN V1, owner 2026-11-14: "maybe we are
 * using Opus 5.5 for some ads agents … Sonnet 4.6 is not really optimized for this work").
 *
 * One line per agent, so moving one agent is one line and one recording — never a side effect of moving
 * another. A line changes only in the PR that re-records that agent's fixtures on the new model
 * (`pnpm ads:eval <worker> --record`, on the owner's key, asked for first) and shows its baseline met or
 * beaten on two runs.
 *
 * Moved 2026-11-14 (V1b; owner: "ok proceed as proposed"), each at its old agreement on two consecutive
 * runs: art director 14 of 14, checker 10 of 10 and analyst 14 of 14 on Opus 5.5; craft judge 6 of 6 and
 * finished-ad judge 16 of 16 on Fable 5.2 — the judges on a different model from the writer, which the
 * 2026-11-10 audit asked for (F-AG7). The analyst was first tried on Sonnet 5.5 and scored 13 of 14 (a
 * number written in words), below its baseline, so it was not moved there.
 *
 * The copywriter followed the same day (V1c), on Opus 5.5: 124 of 124 on two consecutive runs, against 121 of
 * 124 on Sonnet 4.6. Its headlines came out shorter (median 25 → 22 characters), which is why the overlay's
 * capacity is now measured with a frozen set (`creative/overlay/headlineCorpus.json`) and not with whatever
 * the writer's model currently writes. `workers/agentModels.test.ts` fails a line whose
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
  copywriter: { model: "claude-opus-5-5" },
  art_director: { model: "claude-opus-5-5" },
  checker: { model: "claude-opus-5-5" },
  analyst: { model: "claude-opus-5-5" },
  craft_judge: { model: "claude-fable-5-2" },
  finished_ad_judge: { model: "claude-fable-5-2" },
};
