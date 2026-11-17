import { describe, expect, it } from "vitest";
import type { PlanConcept } from "@silvicom/shared";
import { presetRows } from "../../../testing/adsPresetRows.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { availableConcepts, planOffer, usablePresets } from "./concepts.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FOUR: PlanConcept[] = [
  { hook_family: "pay_first", scene_family: "equipment_on_road" }, { hook_family: "life_first", scene_family: "home_street" },
  { hook_family: "equipment_first", scene_family: "equipment_at_rest" }, { hook_family: "proof", scene_family: "abstract_plate" },
];

describe("availableConcepts — the kinds of ad a carrier can make today", () => {
  it("is the hook and scene of each enabled preset, read for this org only", async () => {
    const rec = createSupabaseRecorder({ tables: presetRows(ORG, FOUR) });
    expect(await availableConcepts(rec.client, ORG)).toEqual(FOUR);
    expectOrgScoped(rec, ORG);
  });

  it("a disabled preset offers nothing, though compose can still be told it exists", async () => {
    const rec = createSupabaseRecorder({ tables: presetRows(ORG, FOUR, { disabled: [1] }) });
    expect(await availableConcepts(rec.client, ORG)).toEqual([FOUR[0], FOUR[2], FOUR[3]]);
    expect((await usablePresets(rec.client, ORG)).map((p) => [p.key, p.enabled])).toEqual([["P1", true], ["P2", false], ["P3", true], ["P4", true]]);
  });

  it("an archived preset, and a carrier with no presets, offer nothing", async () => {
    const rows = presetRows(ORG, FOUR);
    rows.ad_concept_presets[0]!.archived_at = "2026-11-10T00:00:00Z" as never;
    expect(await availableConcepts(createSupabaseRecorder({ tables: rows }).client, ORG)).toEqual(FOUR.slice(1));
    expect(await availableConcepts(createSupabaseRecorder({ tables: { ad_concept_presets: [], ad_concept_preset_versions: [] } }).client, ORG)).toEqual([]);
  });
});

describe("planOffer — what one campaign's plan may choose from", () => {
  const STAGING = { DEPLOY_ENVIRONMENT: "staging" };
  const PRODUCTION = { DEPLOY_ENVIRONMENT: "production" };
  const CAMPAIGN = { org_id: ORG, connection_id: "conn-1" };
  const world = (provider: string) => createSupabaseRecorder({ tables: { ...presetRows(ORG, FOUR), ads_platform_connections: [{ provider }] } });

  it("a simulator campaign off production is offered a still and a motion ad, with the carrier's concepts", async () => {
    const rec = world("simulator");
    expect(await planOffer(rec.client, CAMPAIGN, STAGING)).toEqual({ concepts: FOUR, formats: ["still", "motion"] });
    expect(rec.forTable("ads_platform_connections")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: "conn-1" }]));
    expectOrgScoped(rec, ORG);
  });

  it("a real connection is offered a still alone while no video model is chosen, on staging as on production", async () => {
    expect((await planOffer(world("meta").client, CAMPAIGN, STAGING)).formats).toEqual(["still"]);
    expect((await planOffer(world("meta").client, CAMPAIGN, PRODUCTION)).formats).toEqual(["still"]);
  });

  it("a simulator connection on production is offered a still alone", async () => {
    expect((await planOffer(world("simulator").client, CAMPAIGN, PRODUCTION)).formats).toEqual(["still"]);
  });
});
