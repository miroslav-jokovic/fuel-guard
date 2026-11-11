import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, FINISHED_AD_CRITERIA, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { FINISHED_AD_JUDGE_EVAL, loadFixtures } from "../agentFixtures.js";
import { FINISHED_AD_JUDGE_PROMPT_VERSION, finishedAdUserParts, judgeFinishedAds, type JudgeFinishedAdsInput } from "./finishedAdJudge.js";

/**
 * The finished-ad judge (P1-7, Q-AD76): one call per published format through the rail under its own agent and
 * key; switched off or refused it leaves `ran: false` and the reason — never a stop; the recorded answers replay to
 * their fixtures' verdicts and agree with what each image was made to be.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-10T18:00:00Z");
const on: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 5_000_000, agents_enabled: { finished_ad_judge: true } } };
const fixtures = loadFixtures(FINISHED_AD_JUDGE_EVAL);
const IMAGE = readFileSync(new URL("./fixtures/images/clean-highway-pay.jpg", import.meta.url));

function world(settings: AdsSettings = on) {
  let n = 0;
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${++n}` }] : []),
    },
  });
}
const scores = (s: number) => ({ scores: Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, { reason: `scored ${s}`, score: s }])) });
function answering(output: unknown) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "judge_finished_ad", input: output }], usage: { input_tokens: 2000, output_tokens: 300 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const input = (over: Partial<JudgeFinishedAdsInput> = {}): JudgeFinishedAdsInput => ({
  orgId: ORG, campaignId: "c-1", creativeId: "cr-9", attempt: 1,
  ads: [{ format: "4:5", png: IMAGE }, { format: "1:1", png: IMAGE }],
  headline: "$0.65 per mile, Class A OTR.", button: "Apply today", subject: "tractor_and_trailer",
  kit: { company_name: "Fixture Carrier", colors: [{ name: "primary", hex: "#0B3D2E" }] }, logo: null, ...over,
});

describe("finished-ad judge — what it is shown", () => {
  it("the ad, then the logo as its own image when there is one, then the words drawn, the subject and the kit as data", () => {
    const logo = { format: "png" as const, bytes: new Uint8Array([1, 2, 3]) };
    const parts = finishedAdUserParts({ image: { format: "jpeg", bytes: new Uint8Array(IMAGE) }, headline: "H", button: "B", subject: "road_ahead", kit: input().kit, logo });
    expect(parts.map((p) => p.type)).toEqual(["text", "image", "text", "image", "text"]);
    expect(JSON.parse((parts.at(-1) as { text: string }).text)).toEqual({ headline: "H", button: "B", subject: "road_ahead", company: "Fixture Carrier", colors: [{ name: "primary", hex: "#0B3D2E" }] });
    expect(finishedAdUserParts({ ...{ image: { format: "jpeg", bytes: new Uint8Array(IMAGE) }, headline: "H", button: "B", subject: null, kit: input().kit }, logo: null }).map((p) => p.type)).toEqual(["text", "image", "text"]);
  });
});

describe("finished-ad judge — through the rail", () => {
  it("asks once per published format, as the finished-ad judge, under its own key and prompt version", async () => {
    const rec = world();
    const { client, create } = answering(scores(4));
    const out = await judgeFinishedAds({ admin: rec.client, client, now: () => NOW }, input());
    expect(out).toMatchObject({ kind: "judged", check: { ran: true, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION } });
    expect(create).toHaveBeenCalledTimes(2);
    // The rail's own rows: one insert per call (its updates, which settle them, carry no agent).
    expect(rec.writtenRows("ad_generations").filter((r) => r.agent).map((r) => [r.agent, r.idempotency_key])).toEqual([
      ["finished_ad_judge", "finished:cr-9:4:5:1"], ["finished_ad_judge", "finished:cr-9:1:1:1"],
    ]);
    if (out.kind === "judged") expect(Object.keys(out.check.by_format!)).toEqual(["4:5", "1:1"]);
    expectOrgScoped(rec, ORG);
  });

  it("asks no model when switched off, and says so instead of stopping", async () => {
    const { client, create } = answering(scores(4));
    const out = await judgeFinishedAds({ admin: world(ADS_SETTINGS_UNSET).client, client, now: () => NOW }, input());
    expect(out).toEqual({ kind: "judged", check: { ran: false, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, not_run: "agent_off" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("an answer off the 1–5 scale is recorded as not run, never stored as scores", async () => {
    const { client } = answering({ scores: { ...scores(4).scores, hierarchy_reads: { reason: "x", score: 7 } } });
    const out = await judgeFinishedAds({ admin: world().client, client, now: () => NOW }, input({ ads: [{ format: "4:5", png: IMAGE }] }));
    expect(out).toEqual({ kind: "judged", check: { ran: false, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, not_run: "failed (off_schema)" } });
  });
});

describe("finished-ad judge replay — every recorded answer reaches its fixture's verdict", () => {
  it("has model recordings under the prompt in force and planted defects beside them", () => {
    const sources = fixtures.map((f) => f.fixture.recorded.source);
    expect(sources.filter((s) => s === "planted").length).toBeGreaterThanOrEqual(2);
    expect(sources.filter((s) => s === "model").length).toBeGreaterThanOrEqual(7);
    for (const { fixture } of fixtures) expect(fixture.recorded.prompt_version).toBe(FINISHED_AD_JUDGE_PROMPT_VERSION);
  });

  const planted = (name: string) => fixtures.find((x) => x.fixture.name === name)!.fixture;
  it("planted-score-out-of-range", () => {
    const f = planted("planted-score-out-of-range");
    expect(FINISHED_AD_JUDGE_EVAL.judge(f, f.recorded.output).verdict).toBe("off_schema");
  });

  it("planted-missing-criterion", () => {
    const f = planted("planted-missing-criterion");
    expect(FINISHED_AD_JUDGE_EVAL.judge(f, f.recorded.output).verdict).toBe("off_schema");
  });

  it("agreement is about the planted criterion: a weak ad scored 3 there does not agree, and a sound ad scored 2 anywhere does not", () => {
    const weak = fixtures.find((x) => x.fixture.name === "weak-off-kit")!.fixture;
    const sound = fixtures.find((x) => x.fixture.name === "clean-highway-pay")!.fixture;
    const line = (s: Record<string, number>) => FINISHED_AD_CRITERIA.map((c) => `${c}:${s[c] ?? 4}`);
    expect(FINISHED_AD_JUDGE_EVAL.agrees!(weak, "ready", line({ looks_like_kit: 3 }))).toBe(false);
    expect(FINISHED_AD_JUDGE_EVAL.agrees!(weak, "ready", line({ looks_like_kit: 2, hierarchy_reads: 1 }))).toBe(false);
    expect(FINISHED_AD_JUDGE_EVAL.agrees!(weak, "ready", line({ looks_like_kit: 1 }))).toBe(true);
    expect(FINISHED_AD_JUDGE_EVAL.agrees!(sound, "ready", line({ hierarchy_reads: 2 }))).toBe(false);
  });

  it.each(fixtures.filter((f) => f.fixture.recorded.source === "model").map((f) => f.fixture.name))("%s", (name) => {
    const f = fixtures.find((x) => x.fixture.name === name)!.fixture;
    const { verdict, findings } = FINISHED_AD_JUDGE_EVAL.judge(f, f.recorded.output);
    expect(verdict).toBe(f.expect);
    expect(FINISHED_AD_JUDGE_EVAL.agrees!(f, verdict, findings)).toBe(true);
  });
});
