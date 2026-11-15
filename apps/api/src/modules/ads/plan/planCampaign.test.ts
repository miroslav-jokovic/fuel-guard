import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings, type CampaignPlan, type LeadQuality } from "@silvicom/shared";
import type { MessagesClient } from "../../../lib/anthropic.js";
import { presetRows } from "../../../testing/adsPresetRows.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { STRATEGIST_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import { benchmarkEvidence } from "./evidencePack.js";
import { planCampaign } from "./planCampaign.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CAMPAIGN = "5b8f0c1e-2d3a-4b4c-9d5e-6f7a8b9c0d1e";
const KEY = `${CAMPAIGN}:2026-11-15T18:00:00.000+00:00`;
const NOW = new Date("2026-11-15T18:20:00Z");

const fixtures = loadFixtures(STRATEGIST_EVAL);
const fx = (name: string) => fixtures.find((f) => f.fixture.name === name)!.fixture;
/** The carrier can make the starter five kinds of ad, as the fixture says. */
const concepts = fx("planted-sound").input.concepts;
const brief = fx("planted-sound").input.brief;
const sound = fx("planted-sound").recorded.output as CampaignPlan;
const invented = fx("planted-invented-figure").recorded.output as CampaignPlan;
const quality: LeadQuality = { qualitySince: async () => [] };

function settingsWith(over: Partial<AdsSettings["budgets"]>): AdsSettings {
  return { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { strategist: true }, ...over } };
}

function world(opts: { settings?: AdsSettings; generations?: unknown[]; snapshot?: unknown; concepts?: typeof concepts } = {}) {
  let made = 0;
  return createSupabaseRecorder({
    tables: {
      ads_campaigns: [{ brief_snapshot: opts.snapshot ?? brief }],
      ads_ad_spend_hourly: [],
      ...presetRows(ORG, opts.concepts ?? concepts),
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: opts.settings ?? settingsWith({}), kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${(made += 1)}` }] : (opts.generations ?? [])),
      ads_campaign_plans: (q) => (q.write?.method === "insert" ? [{ id: "p-1", ...(q.write.payload as object) }] : []),
    },
  });
}

/** A model that answers each call with the next plan in `outputs`. */
function answering(...outputs: unknown[]) {
  let n = 0;
  const create = vi.fn(async (_body: unknown) => ({
    id: `msg_${n + 1}`, stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "write_plan", input: outputs[Math.min(n++, outputs.length - 1)] }],
    usage: { input_tokens: 2500, output_tokens: 900 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const run = (rec: ReturnType<typeof world>, client: MessagesClient) => planCampaign({ admin: rec.client, client, now: () => NOW, quality }, { id: CAMPAIGN, org_id: ORG }, KEY);

describe("planCampaign", () => {
  it("builds the pack, asks the Strategist once and stores its plan as version 1 with that pack and that generation", async () => {
    const rec = world();
    const { client, create } = answering(sound);
    expect(await run(rec, client)).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    const [row] = rec.writtenRows("ads_campaign_plans");
    expect(row).toMatchObject({ org_id: ORG, campaign_id: CAMPAIGN, version: 1, plan: sound, author_kind: "agent", generation_id: "gen-1" });
    // The stored evidence is the sheet's evidence: what the model was shown is what the row keeps.
    const sent = JSON.parse((create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content) as { evidence: unknown[] };
    expect(row!.evidence).toEqual(sent.evidence);
    expect(sent.evidence).toContainEqual(benchmarkEvidence());
    expect(rec.writtenRows("ad_generations")[0]).toMatchObject({ idempotency_key: `plan:${KEY}:1`, campaign_id: CAMPAIGN });
    expectOrgScoped(rec, ORG);
  });

  it("a refused plan is asked for once more, with the plan and its findings, and the second answer is the one stored", async () => {
    const rec = world();
    const { client, create } = answering(invented, sound);
    expect(await run(rec, client)).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    const second = JSON.parse((create.mock.calls[1]![0] as { messages: Array<{ content: string }> }).messages[0]!.content) as { refused_plan: unknown; refused_because: string[] };
    expect(second.refused_plan).toEqual(invented);
    expect(second.refused_because).toHaveLength(1);
    expect(second.refused_because[0]).toMatch(/^audience says /);
    // Each ask is an insert and then its completion; only the insert carries the key.
    expect(rec.writtenRows("ad_generations").map((g) => g.idempotency_key).filter(Boolean)).toEqual([`plan:${KEY}:1`, `plan:${KEY}:2`]);
    expect(rec.writtenRows("ads_campaign_plans")[0]).toMatchObject({ plan: sound, generation_id: "gen-2" });
  });

  it("a plan refused twice fails with what was wrong, asks no third time and stores nothing", async () => {
    const rec = world();
    const { client, create } = answering(invented, invented);
    const out = await run(rec, client);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^the plan was refused twice: audience says ".*", which the job's facts do not hold \(.*\)\.$/) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(rec.writtenRows("ads_campaign_plans")).toEqual([]);
  });

  it("names three findings and counts the rest, so the reason fits a card", async () => {
    const many: CampaignPlan = { ...sound, audience_evidence: ["market:a", "market:b", "market:c", "market:d", "market:e"] };
    const out = await run(world(), answering(many, many).client);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/cites market:a.*cites market:b.*cites market:c, which is not on the sheet\. \(and 2 more\)$/) });
  });

  it("waits, moving nothing, while the Strategist's call is still in flight", async () => {
    const rec = world({ generations: [{ id: "gen-0", status: "started", output: null, error_code: null, started_at: NOW.toISOString(), request: {} }] });
    const { client, create } = answering(sound);
    expect(await run(rec, client)).toEqual({ ok: false, pending: true, why: "the Strategist is still writing" });
    expect(create).not.toHaveBeenCalled();
    expect(rec.writes()).toEqual([]);
  });

  it("fails in words the office can act on: switched off, no budget set, an answer that is not a plan", async () => {
    const off = await run(world({ settings: settingsWith({ agents_enabled: {} }) }), answering(sound).client);
    expect(off).toEqual({ ok: false, error: "the Strategist is switched off in the ads settings" });
    const unset = await run(world({ settings: settingsWith({ anthropic_tokens_monthly: null }) }), answering(sound).client);
    expect(unset).toEqual({ ok: false, error: "no monthly AI budget is set in the ads settings" });
    const short = await run(world(), answering({ ...sound, angles: sound.angles.slice(0, 2) }).client);
    expect(short).toEqual({ ok: false, error: "the Strategist's answer could not be used (off_schema)" });
  });

  it("sends the carrier's concepts on the sheet and stores a plan held to them", async () => {
    const { client, create } = answering(sound);
    await run(world(), client);
    const sent = JSON.parse((create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content) as { concepts: Array<Record<string, string>> };
    expect(sent.concepts.map(({ hook_family, scene_family }) => ({ hook_family, scene_family }))).toEqual(concepts);
    expect(sent.concepts[0]).toHaveProperty("leads_with");
  });

  it("a plan naming a kind of ad the carrier cannot make is refused and asked for again, like any finding", async () => {
    // The carrier has four kinds; the sound plan's third idea is the one it lacks.
    const four = concepts.filter((c) => !(c.hook_family === sound.angles[2]!.hook_family && c.scene_family === sound.angles[2]!.scene_family));
    const { client, create } = answering(sound, sound);
    const out = await run(world({ concepts: four }), client);
    expect(create).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("angle 3 uses a hook and scene that is not one of the concepts on the sheet.") });
  });

  it("with fewer than three kinds of ad enabled no plan can pass: the model is not asked and the reason says what to do", async () => {
    const { client, create } = answering(sound);
    const out = await run(world({ concepts: concepts.slice(0, 2) }), client);
    expect(out).toEqual({ ok: false, error: "a plan needs at least 3 different kinds of ad, and 2 are enabled: enable more ad presets in Settings, each with its own lead and picture" });
    expect(create).not.toHaveBeenCalled();
    expect(await run(world({ concepts: concepts.slice(0, 1) }), client)).toMatchObject({ error: expect.stringContaining("and 1 is enabled") });
  });

  it("asks no model when the campaign's brief does not parse", async () => {
    const { client, create } = answering(sound);
    expect(await run(world({ snapshot: { subject: 7 } }), client)).toEqual({ ok: false, error: "the campaign's brief does not parse" });
    expect(create).not.toHaveBeenCalled();
  });
});
