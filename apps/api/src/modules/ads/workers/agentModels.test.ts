import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AD_AGENT_MODELS, type AdClaudeAgent } from "@silvicom/shared";

/**
 * A model line in `AD_AGENT_MODELS` moves only with that worker's recording (ADS-PLATFORM-V2-PLAN V1).
 *
 * `lint:agent-fixtures` holds a worker's prompt, fixtures and baseline to each other; it never knew which
 * model the worker asks. Without this, an edit to the table would ship a model no recording was made on,
 * behind a baseline that still reads green. `pnpm ads:eval <worker> --record` writes `baseline.json`'s
 * `model` from the request it sent, so the two agree exactly when the recording was made on today's line.
 */
const WORKER_DIR: Record<AdClaudeAgent, string> = {
  copywriter: "copywriter",
  art_director: "artDirector",
  checker: "checker",
  analyst: "analyst",
  craft_judge: "craftJudge",
  finished_ad_judge: "finishedAdJudge",
  strategist: "strategist",
  researcher: "researcher",
  swipe_reader: "swipeReader",
};

describe("each ads agent's baseline was recorded on the model it asks", () => {
  for (const agent of Object.keys(AD_AGENT_MODELS) as AdClaudeAgent[]) {
    it(`${agent}`, () => {
      const baseline = JSON.parse(readFileSync(new URL(`./${WORKER_DIR[agent]}/baseline.json`, import.meta.url), "utf8")) as { model: string };
      expect(baseline.model).toBe(AD_AGENT_MODELS[agent].model);
    });
  }
});
