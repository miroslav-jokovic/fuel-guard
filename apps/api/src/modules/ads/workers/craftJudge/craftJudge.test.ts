import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { CRAFT_JUDGE_EVAL, loadFixtures } from "../agentFixtures.js";
import { CRAFT_JUDGE_PROMPT_VERSION, judgeAnswer, judgeCraft, judgeUserMessage, presentationOrder } from "./craftJudge.js";

/**
 * The craft judge (CQ4, D-AD21): the candidates are shown in a seeded order so the model's position bias cannot
 * favour the Copywriter's first; the scores come back in the Copywriter's order; the call goes through the rail
 * under its own agent and key.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-09T18:00:00Z");
const settings: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 5_000_000, agents_enabled: { craft_judge: true } } };
const fixtures = loadFixtures(CRAFT_JUDGE_EVAL);
const fx = fixtures.find((f) => f.fixture.name === "filler-last-p1-otr")!.fixture;

function world() {
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : []),
    },
  });
}
function answering(output: unknown) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "judge_copy", input: output }], usage: { input_tokens: 900, output_tokens: 300 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const score = (n: number) => ({ reason: `scored ${n}`, scores: { hook: n, specific: n, plain: n, spanish: n, no_filler: n } });

describe("craft judge — presentation order and the mapping back", () => {
  it("the order is a permutation drawn from the seed, the same every time, and not the identity for a typical seed", () => {
    const a = presentationOrder("cr-7", 5);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(presentationOrder("cr-7", 5)).toEqual(a);
    const identityCount = Array.from({ length: 50 }, (_, i) => presentationOrder(`seed-${i}`, 4)).filter((o) => o.every((v, i) => v === i)).length;
    expect(identityCount).toBeLessThan(10);
  });

  it("scores answered in the shown order come back in the Copywriter's order", () => {
    const presented = [2, 0, 1];
    const back = judgeAnswer({ scores: [score(5), score(1), score(3)] }, presented);
    expect(back.map((s) => s.scores.hook)).toEqual([1, 3, 5]);
  });

  it("the judge sees the candidates in the shown order and is not told how many the writer was asked for", () => {
    const presented = presentationOrder(fx.input.seed, fx.input.candidates.length);
    const sent = JSON.parse(judgeUserMessage(fx.input.brief, fx.input.recipe, fx.input.candidates, { company_name: fx.input.company_name }, presented)) as { candidates: unknown[] } & Record<string, unknown>;
    expect(sent.candidates).toEqual(presented.map((i) => fx.input.candidates[i]));
    expect(Object.keys(sent).sort()).toEqual(["about_the_job", "candidates", "company", "concept", "facts", "in_our_words", "subject"]);
  });
});

describe("craft judge — through the rail", () => {
  it("asks once per creative and attempt, as the craft judge, under its own key and prompt version, and maps the scores back", async () => {
    const rec = world();
    const n = fx.input.candidates.length;
    const { client, create } = answering({ scores: Array.from({ length: n }, (_, pos) => score(pos + 1)) });
    const out = await judgeCraft({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, campaignId: "c-1", creativeId: "cr-9", attempt: 1, brief: fx.input.brief, recipe: fx.input.recipe, candidates: fx.input.candidates, company_name: fx.input.company_name });
    expect(out.kind).toBe("ready");
    expect(rec.writtenRows("ad_generations")[0]).toMatchObject({ agent: "craft_judge", idempotency_key: "judge:cr-9:1", prompt_version: CRAFT_JUDGE_PROMPT_VERSION, creative_id: "cr-9" });
    expect(create).toHaveBeenCalledTimes(1);
    // Position p was scored p+1; candidate presented[p] therefore holds p+1.
    const presented = presentationOrder("cr-9", n);
    if (out.kind === "ready") presented.forEach((candidate, pos) => expect(out.scores[candidate]!.scores.hook).toBe(pos + 1));
    expectOrgScoped(rec, ORG);
  });

  it("asks no model when the craft judge is switched off", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: ADS_SETTINGS_UNSET, kill_switch: false }], ad_generations: [] } });
    const { client, create } = answering({ scores: [] });
    const out = await judgeCraft({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, campaignId: "c-1", creativeId: "cr-1", attempt: 1, brief: fx.input.brief, recipe: fx.input.recipe, candidates: fx.input.candidates });
    expect(out).toEqual({ kind: "agent_off" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("craft judge replay — every recorded answer reaches its fixture's verdict", () => {
  it("has model recordings under the prompt in force and planted defects beside them", () => {
    const sources = fixtures.map((f) => f.fixture.recorded.source);
    expect(sources.filter((s) => s === "planted").length).toBeGreaterThanOrEqual(2);
    for (const { fixture } of fixtures) expect(fixture.recorded.prompt_version).toBe(CRAFT_JUDGE_PROMPT_VERSION);
  });

  it("planted-score-out-of-range", () => {
    const f = fixtures.find((x) => x.fixture.name === "planted-score-out-of-range")!.fixture;
    expect(CRAFT_JUDGE_EVAL.judge(f, f.recorded.output).verdict).toBe("off_schema");
  });

  it("planted-filler-ranked-first", () => {
    const f = fixtures.find((x) => x.fixture.name === "planted-filler-ranked-first")!.fixture;
    const { verdict, findings } = CRAFT_JUDGE_EVAL.judge(f, f.recorded.output);
    // Equal scores everywhere: the ranking is the Copywriter's order, and the planted filler (offered last) ends last by
    // chance of position, so a flat judge "agrees" here — which is why `agrees` is measured over the whole set, not one.
    expect(verdict).toBe("ready");
    expect(findings).toHaveLength(f.input.candidates.length);
  });

  it.each(fixtures.filter((f) => f.fixture.recorded.source === "model" && f.fixture.recorded.output).map((f) => f.fixture.name))("%s", (name) => {
    const f = fixtures.find((x) => x.fixture.name === name)!.fixture;
    const { verdict, findings } = CRAFT_JUDGE_EVAL.judge(f, f.recorded.output);
    expect(verdict).toBe(f.expect);
    expect(CRAFT_JUDGE_EVAL.agrees!(f, verdict, findings)).toBe(true);
  });
});
