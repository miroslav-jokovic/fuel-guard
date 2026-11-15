import { describe, expect, it } from "vitest";
import { drawPresets, type CampaignPlan, type PlanAngle, type PresetDraw } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { CampaignRow } from "../orchestrator/transitions.js";
import { campaignDraw } from "./composeCampaign.js";

/**
 * Which presets a campaign's ads are made from (ADS-PLATFORM-V2-PLAN V2c): a campaign with an approved plan
 * is made from the plan's ideas, in the plan's order; one with no plan draws by seed, as before planning.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PLAN_ID = "71000000-0000-4000-8000-000000000001";
const c = { id: "c-1", org_id: ORG, connection_id: "conn", state: "composing", state_changed_at: "2026-11-15T19:00:00.000Z" } as CampaignRow;

const preset = (n: number, hook_family: string, scene_family: string, enabled = true) => ({ id: `p-${n}`, key: `P${n}`, current: { id: `pv-${n}`, enabled, body: { hook_family, scene_family } as never } });
const PRESETS = [
  preset(1, "equipment_first", "equipment_at_rest"), preset(2, "pay_first", "equipment_on_road"),
  preset(3, "life_first", "home_street"), preset(4, "proof", "abstract_plate"), preset(5, "straight_talk", "cab_pov"),
];
const angle = (hook_family: PlanAngle["hook_family"], scene_family: PlanAngle["scene_family"]): PlanAngle => ({ hook_family, scene_family, format: "still", idea: "An idea for this ad.", proof: "A fact of the job.", why: "Because of the evidence.", evidence: ["job:subject"] });
/** The plan's order is NOT the presets' key order, so an answer in key order is visibly wrong. */
const plan: CampaignPlan = { audience: "Regional drivers who want a steady week.", audience_evidence: ["job:subject"], angles: [angle("straight_talk", "cab_pov"), angle("pay_first", "equipment_on_road"), angle("life_first", "home_street")] };

/** The plan of the campaign's `plan_id`, as `composeCampaign` reads it and hands it over. */
const APPROVED = { id: PLAN_ID, plan };

function world(opts: { live?: { campaigns: string[]; versions: string[] } } = {}) {
  let stored: PresetDraw | null = null;
  return createSupabaseRecorder({
    tables: {
      ads_campaigns: (q) => {
        if (q.write) { stored = (q.write.payload as { preset_draw: PresetDraw }).preset_draw; return [{ preset_draw: stored }]; }
        if (q.filters().some((f) => f.col === "brief_ref")) return (opts.live?.campaigns ?? []).map((id) => ({ id }));
        return [{ preset_draw: stored }];
      },
      ads_creatives: (opts.live?.versions ?? []).map((preset_version_id) => ({ preset_version_id })),
      ad_concept_preset_versions: (opts.live?.versions ?? []).map((id) => ({ id, preset_id: id.replace("pv-", "p-") })),
    },
  });
}
const row = (over: Partial<{ preset_draw: PresetDraw | null; plan_id: string | null }> = {}) => ({ brief_ref: "opening@v1", preset_draw: null, plan_id: PLAN_ID, ...over });

describe("campaignDraw — a planned campaign", () => {
  it("is made from the plan's ideas in the plan's order, and stores that as the campaign's draw", async () => {
    const rec = world();
    const out = await campaignDraw(rec.client, c, row(), PRESETS, APPROVED);
    expect(out).toMatchObject({ ok: true, draw: { seed: `plan:${PLAN_ID}`, order: ["pv-5", "pv-2", "pv-3"], exhausted: false } });
    expect(rec.writtenRows("ads_campaigns")).toEqual([{ preset_draw: expect.objectContaining({ order: ["pv-5", "pv-2", "pv-3"] }) }]);
    expectOrgScoped(rec, ORG);
  });

  it("is not the seeded draw: the same campaign with no plan draws every enabled preset by its seed", async () => {
    const out = await campaignDraw(world().client, c, row({ plan_id: null }), PRESETS, null);
    const seeded = drawPresets("c-1", PRESETS.map((p) => ({ version_id: p.current.id, key: p.key, enabled: true })), []);
    expect(out).toMatchObject({ ok: true, draw: { seed: "c-1", order: seeded.order } });
    expect(seeded.order).toHaveLength(5);
  });

  it("a draw already stored is kept as it is: nothing is read and nothing is written", async () => {
    const kept: PresetDraw = { seed: "c-1", eligible: ["pv-1"], excluded_live: [], order: ["pv-1"], exhausted: false };
    const rec = world();
    expect(await campaignDraw(rec.client, c, row({ preset_draw: kept }), PRESETS, APPROVED)).toEqual({ ok: true, draw: kept });
    expect(rec.queries).toEqual([]);
  });

  it("leaves out an idea whose preset already runs for this opening in another campaign", async () => {
    const out = await campaignDraw(world({ live: { campaigns: ["c-9"], versions: ["pv-2"] } }).client, c, row(), PRESETS, APPROVED);
    expect(out).toMatchObject({ ok: true, draw: { order: ["pv-5", "pv-3"], excluded_live: ["P2"] } });
  });

  it("fails with a reason a person can act on when none of the plan's ideas can be made", async () => {
    const off = PRESETS.map((p) => ({ ...p, current: { ...p.current, enabled: false } }));
    expect(await campaignDraw(world().client, c, row(), off, APPROVED)).toEqual({ ok: false, error: "none of the plan's ideas can be made: the ad preset for each is disabled, or already runs for this opening" });
    expect(await campaignDraw(world().client, c, row({ plan_id: null }), off, null)).toMatchObject({ ok: false, error: expect.stringMatching(/^no preset to draw/) });
  });
});
