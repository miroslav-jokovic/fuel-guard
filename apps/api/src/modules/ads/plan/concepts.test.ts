import { describe, expect, it } from "vitest";
import type { PlanConcept } from "@silvicom/shared";
import { presetRows } from "../../../testing/adsPresetRows.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { availableConcepts, usablePresets } from "./concepts.js";

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
