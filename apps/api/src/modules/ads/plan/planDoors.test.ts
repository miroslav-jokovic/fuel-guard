import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignPlan } from "@silvicom/shared";
import { ORG, campaign, createAdsWorld } from "../../../testing/adsWorld.js";
import { presetRows } from "../../../testing/adsPresetRows.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { STRATEGIST_EVAL, loadFixtures, strategistPack } from "../workers/agentFixtures.js";
import { approvePlan, readPlan, savePlanEdit } from "./planDoors.js";

const C = "70000000-0000-4000-8000-000000000001";
const P1 = "71000000-0000-4000-8000-000000000001";
const P2 = "71000000-0000-4000-8000-000000000002";
const AT = new Date("2026-11-15T19:00:00Z");
const koni = { id: "u-koni", name: "Koni" };

const fx = loadFixtures(STRATEGIST_EVAL).find((f) => f.fixture.name === "planted-sound")!.fixture;
const sound = fx.recorded.output as CampaignPlan;
const evidence = strategistPack(fx);
const planRow = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, campaign_id: C, version, plan: sound, evidence, author_kind: "agent", generation_id: `g-${version}`, author_id: null, author_name: null, created_at: "2026-11-15T18:30:00+00:00", ...over,
});

describe("approvePlan — a person approves the newest version, by name", () => {
  const world = (state: Parameters<typeof campaign>[1], plans = [planRow(P1, 1), planRow(P2, 2, { author_kind: "person", generation_id: null, author_id: "u-x", author_name: "Jeni" })]) =>
    createAdsWorld({ campaigns: [campaign(C, state)], extraTables: { ads_campaign_plans: plans } });

  it("moves the campaign to composing with that plan named on it, recorded as the person's act", async () => {
    const w = world("plan_review");
    expect(await approvePlan(w.admin, ORG, koni, C, { plan_id: P2 }, AT)).toEqual({ kind: "moved", to: "composing" });
    expect(w.byId(C)).toMatchObject({ state: "composing", plan_id: P2 });
    expect(w.transitions(C)).toEqual([expect.objectContaining({ status: "succeeded", actor_kind: "person", actor_id: "u-koni" })]);
    expectOrgScoped(w.rec, ORG);
  });

  it("an earlier version is refused as stale — somebody edited the plan since — and nothing moves", async () => {
    const w = world("plan_review");
    expect(await approvePlan(w.admin, ORG, koni, C, { plan_id: P1 }, AT)).toEqual({ kind: "stale", latest: 2 });
    expect(w.byId(C).state).toBe("plan_review");
    expect(w.transitions(C)).toEqual([]);
  });

  it("an id that is no plan of this campaign is stale too, and a campaign never planned has nothing to approve", async () => {
    expect(await approvePlan(world("plan_review").admin, ORG, koni, C, { plan_id: "71000000-0000-4000-8000-0000000000ff" }, AT)).toEqual({ kind: "stale", latest: 2 });
    expect(await approvePlan(world("plan_review", []).admin, ORG, koni, C, { plan_id: P1 }, AT)).toEqual({ kind: "stale", latest: null });
  });

  it("from any state but plan review the machine refuses, and the plan is not written on the campaign", async () => {
    for (const state of ["draft", "planning", "composing", "review"] as const) {
      const w = world(state);
      expect(await approvePlan(w.admin, ORG, koni, C, { plan_id: P2 }, AT), state).toEqual({ kind: "refused", reason: "illegal_transition" });
      expect(w.byId(C), state).toMatchObject({ state });
      expect(w.byId(C).plan_id ?? null, state).toBeNull();
    }
  });

  it("a campaign that does not exist is not found", async () => {
    const w = createAdsWorld({ campaigns: [], extraTables: { ads_campaign_plans: [planRow(P1, 1)] } });
    expect(await approvePlan(w.admin, ORG, koni, C, { plan_id: P1 }, AT)).toEqual({ kind: "not_found" });
  });
});

describe("savePlanEdit — a person's edit is the next version, only while the plan waits for review", () => {
  const edited: CampaignPlan = { ...sound, audience: "Regional flatbed drivers who want a week they can plan around." };
  function world(state: string | null, plans = [planRow(P1, 1)], concepts = fx.input.concepts) {
    return createSupabaseRecorder({
      tables: {
        ...presetRows(ORG, concepts),
        ads_campaigns: state === null ? [] : [{ state, brief_snapshot: fx.input.brief }],
        ads_campaign_plans: (q) => (q.write ? [{ ...planRow(P2, 0), ...(q.write.payload as object), id: P2 }] : [...plans].sort((a, b) => b.version - a.version)),
      },
    });
  }

  it("saves version 2 under the person's name, on version 1's evidence, and answers the view without their id", async () => {
    const rec = world("plan_review");
    const out = await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: edited });
    expect(out).toEqual({ kind: "saved", plan: { id: P2, version: 2, plan: edited, evidence, author_kind: "person", author_name: "Koni", created_at: "2026-11-15T18:30:00+00:00" } });
    expect(rec.writtenRows("ads_campaign_plans")).toEqual([expect.objectContaining({ org_id: ORG, campaign_id: C, version: 2, author_id: "u-koni", author_name: "Koni" })]);
    expectOrgScoped(rec, ORG);
  });

  it("an edit of version 2 is saved as version 3: the version the person had open is what is checked", async () => {
    const rec = world("plan_review", [planRow(P1, 1), planRow(P2, 2)]);
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 2, plan: edited })).toMatchObject({ kind: "saved", plan: { version: 3 } });
  });

  it.each(["draft", "planning", "composing", "review", "live"])("is refused in %s, before any plan is read or written", async (state) => {
    const rec = world(state);
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: edited })).toEqual({ kind: "not_in_plan_review" });
    expect(rec.forTable("ads_campaign_plans")).toEqual([]);
  });

  it("an edit of a version that is no longer the newest is stale; a missing campaign is not found", async () => {
    expect(await savePlanEdit(world("plan_review", [planRow(P1, 1), planRow(P2, 2)]).client, ORG, koni, C, { based_on_version: 1, plan: edited })).toEqual({ kind: "stale", latest: 2 });
    expect(await savePlanEdit(world(null).client, ORG, koni, C, { based_on_version: 1, plan: edited })).toEqual({ kind: "not_found" });
  });

  it("an edit that states a figure the opening does not hold is refused with the finding, and nothing is written", async () => {
    const rec = world("plan_review");
    const out = await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: { ...sound, audience: "Regional flatbed drivers who want $0.80 a mile and a steady week." } });
    expect(out).toMatchObject({ kind: "refused", findings: [{ kind: "claim", where: "audience" }], off_schema: null });
    expect(rec.writes()).toEqual([]);
  });
});

describe("savePlanEdit — an edit is held to the kinds of ad the carrier can make today", () => {
  it("an idea changed to a lead and picture no enabled preset has is refused, naming the idea", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        ...presetRows(ORG, fx.input.concepts),
        ads_campaigns: [{ state: "plan_review", brief_snapshot: fx.input.brief }],
        ads_campaign_plans: (q) => (q.write ? [] : [planRow(P1, 1)]),
      },
    });
    const changed: CampaignPlan = { ...sound, angles: [{ ...sound.angles[0]!, hook_family: "proof", scene_family: "cab_pov" }, ...sound.angles.slice(1)] };
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: changed })).toMatchObject({ kind: "refused", findings: [{ kind: "concept_not_available", where: "angle 1" }] });
    expect(rec.writes()).toEqual([]);
  });
});

describe("readPlan", () => {
  it("answers the newest version as the screen reads it, with the kinds of ad the carrier can make; null when never planned; not found for no campaign", async () => {
    const w = createAdsWorld({ campaigns: [campaign(C, "plan_review")], extraTables: { ads_campaign_plans: [planRow(P1, 1), planRow(P2, 2)], ...presetRows(ORG, fx.input.concepts) } });
    const out = await readPlan(w.admin, ORG, C);
    expect(out).toMatchObject({ kind: "ok", plan: { id: P2, version: 2, author_kind: "agent", author_name: null }, concepts: fx.input.concepts, formats: ["still"] });
    expect(out.kind === "ok" && out.plan && Object.keys(out.plan).sort()).toEqual(["author_kind", "author_name", "created_at", "evidence", "id", "plan", "version"]);
    // Never planned: no plan, and no presets are read for an editor that will not open.
    const none = createAdsWorld({ campaigns: [campaign(C, "draft")], extraTables: { ads_campaign_plans: [] } });
    expect(await readPlan(none.admin, ORG, C)).toEqual({ kind: "ok", plan: null, concepts: [], formats: [] });
    expect(none.rec.forTable("ad_concept_presets")).toEqual([]);
    expect(await readPlan(createAdsWorld({ campaigns: [], extraTables: { ads_campaign_plans: [planRow(P1, 1)] } }).admin, ORG, C)).toEqual({ kind: "not_found" });
    expectOrgScoped(w.rec, ORG);
  });
});

describe("the plan doors hold a plan to the formats its campaign can be made in", () => {
  afterEach(() => vi.unstubAllEnvs());
  const moving: CampaignPlan = { ...sound, angles: [{ ...sound.angles[0]!, format: "motion" }, ...sound.angles.slice(1)] };
  const world = (provider: string) => createSupabaseRecorder({
    tables: {
      ...presetRows(ORG, fx.input.concepts),
      ads_campaigns: [{ id: C, org_id: ORG, state: "plan_review", brief_snapshot: fx.input.brief, connection_id: "conn-1" }],
      ads_platform_connections: [{ provider }],
      ads_campaign_plans: (q) => (q.write ? [{ ...planRow(P2, 0), ...(q.write.payload as object), id: P2 }] : [planRow(P1, 1)]),
    },
  });

  it("an idea changed to a video is refused on a campaign with no video model, and nothing is written", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "staging");
    const rec = world("meta");
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: moving })).toMatchObject({ kind: "refused", findings: [{ kind: "format_not_built", where: "angle 1", format: "motion" }] });
    expect(rec.writes()).toEqual([]);
  });

  it("the same edit is saved on a simulator campaign off production, and the read offers both formats there", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "staging");
    const rec = world("simulator");
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: moving })).toMatchObject({ kind: "saved", plan: { version: 2 } });
    expect(await readPlan(rec.client, ORG, C)).toMatchObject({ kind: "ok", formats: ["still", "motion"] });
  });

  it("a simulator campaign on production is offered a still alone", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "production");
    const rec = world("simulator");
    expect(await readPlan(rec.client, ORG, C)).toMatchObject({ kind: "ok", formats: ["still"] });
    expect(await savePlanEdit(rec.client, ORG, koni, C, { based_on_version: 1, plan: moving })).toMatchObject({ kind: "refused", findings: [{ kind: "format_not_built" }] });
  });
});
