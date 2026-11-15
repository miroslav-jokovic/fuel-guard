import { describe, expect, it } from "vitest";
import { ADS_BENCHMARK_SUGGESTIONS, evidencePackSchema, jobEvidence, type LeadQuality, type LeadQualityCounts } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import { benchmarkEvidence, buildEvidencePack, conceptResults, leadEvidence, resultEvidence } from "./evidencePack.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-15T18:20:00Z");
const brief = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture.input.brief;

const counts = (over: Partial<LeadQualityCounts>): LeadQualityCounts => ({
  campaign_id: "meta-1", leads: 0, attempted: 0, wrong_number: 0, reached: 0, not_qualified: 0, median_first_attempt_minutes: null, closed: {}, ...over,
});
function quality(rows: LeadQualityCounts[] = []): LeadQuality & { asked: Array<[string, string]> } {
  const asked: Array<[string, string]> = [];
  return { asked, qualitySince: async (org, since) => { asked.push([org, since]); return rows; } };
}

const hour = (creative_id: string, spend_cents: number | string, leads: number, impressions = 1000) =>
  ({ creative_id, language: "en", spend_cents, impressions, clicks: 10, leads });
const version = (id: string, hook_family?: string, scene_family?: string) => ({ id, recipe: { hook_family, scene_family, copy_slots: {} } });

function world(opts: { hours?: unknown[] | { pages: unknown[][] }; snapshot?: unknown; campaign?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      ads_campaigns: opts.campaign === false ? [] : [{ brief_snapshot: opts.snapshot ?? brief }],
      ads_ad_spend_hourly: opts.hours ?? [],
      ads_creatives: [{ id: "cr-1", preset_version_id: "v-1" }, { id: "cr-2", preset_version_id: "v-2" }, { id: "cr-3", preset_version_id: "v-old" }],
      ad_concept_preset_versions: [version("v-1", "pay_first", "cab_pov"), version("v-2", "life_first", "home_street"), version("v-old")],
    },
  });
}

describe("buildEvidencePack", () => {
  it("a carrier whose ads never ran is planned from the job and the benchmark alone", async () => {
    const rec = world();
    const q = quality();
    const out = await buildEvidencePack({ admin: rec.client, now: () => NOW, quality: q }, { id: "c-1", org_id: ORG });
    if (!out.ok) throw new Error(out.error);
    expect(out.evidence).toEqual([...jobEvidence(brief), benchmarkEvidence()]);
    expect(out.brief).toEqual(brief);
    // No hour came back, so neither the creatives nor the presets were asked for.
    expect(rec.forTable("ads_creatives")).toEqual([]);
    expect(rec.forTable("ad_concept_preset_versions")).toEqual([]);
  });

  it("reads the last 28 days from the top of the hour, for this org only, in both readers", async () => {
    const rec = world();
    const q = quality();
    await buildEvidencePack({ admin: rec.client, now: () => NOW, quality: q }, { id: "c-1", org_id: ORG });
    expect(q.asked).toEqual([[ORG, "2026-10-18T18:00:00.000Z"]]);
    expect(rec.forTable("ads_ad_spend_hourly")[0]!.ops).toContainEqual({ method: "gte", args: ["hour", "2026-10-18T18:00:00.000Z"] });
    expect(rec.forTable("ads_campaigns")[0]!.ops).toContainEqual({ method: "eq", args: ["id", "c-1"] });
    expectOrgScoped(rec, ORG);
  });

  it("holds the job, the benchmark, the lead counts and each concept's result, every id unique and of its kind", async () => {
    const rec = world({ hours: [hour("cr-1", 9_000, 3), hour("cr-2", 4_000, 0)] });
    const q = quality([counts({ leads: 10, attempted: 8, reached: 5, closed: { out_of_area: 4 } })]);
    const out = await buildEvidencePack({ admin: rec.client, now: () => NOW, quality: q }, { id: "c-1", org_id: ORG });
    if (!out.ok) throw new Error(out.error);
    expect(evidencePackSchema.safeParse(out.evidence).success).toBe(true);
    expect(out.evidence.filter((e) => e.kind !== "job").map((e) => e.id)).toEqual([
      "benchmark:cost_per_lead", "lead_outcome:reached", "lead_outcome:closed_out_of_area",
      "our_result:life_first_home_street", "our_result:pay_first_cab_pov",
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("fails with its reason when the campaign is missing or its brief does not parse", async () => {
    const deps = (rec: ReturnType<typeof world>) => ({ admin: rec.client, now: () => NOW, quality: quality() });
    expect(await buildEvidencePack(deps(world({ campaign: false })), { id: "c-1", org_id: ORG })).toEqual({ ok: false, error: "the campaign was not found" });
    expect(await buildEvidencePack(deps(world({ snapshot: { subject: 7 } })), { id: "c-1", org_id: ORG })).toEqual({ ok: false, error: "the campaign's brief does not parse" });
  });

  it("refuses the pack, rather than hand on an item the contract does not allow, when a closed reason is not a plain key", async () => {
    const q = quality([counts({ leads: 2, closed: { "Not Interested!": 1 } })]);
    const out = await buildEvidencePack({ admin: world().client, now: () => NOW, quality: q }, { id: "c-1", org_id: ORG });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/^the evidence pack does not hold: /);
  });
});

describe("benchmarkEvidence", () => {
  it("quotes the figures the settings screen cites, from the same constant", () => {
    expect(ADS_BENCHMARK_SUGGESTIONS).toMatchObject({ cpl_max_cents: 4_200, cpl_min_leads: 5, no_lead_spend_cents: 8_500 });
    expect(benchmarkEvidence().text).toBe(
      "Boostpoint 2026 benchmark, CDL drivers on Meta: an ad costing more than $42.00 per lead after 5 leads, or $85.00 spent with no lead, is where pausing is suggested.",
    );
  });
});

describe("leadEvidence", () => {
  it("says nothing when no lead arrived — a zero is not a finding", () => {
    expect(leadEvidence([])).toEqual([]);
    expect(leadEvidence([counts({ closed: { spam: 0 } })])).toEqual([]);
  });

  it("sums the carrier's campaigns and gives one sentence per count that is not zero, reasons in key order", () => {
    const items = leadEvidence([
      counts({ campaign_id: "a", leads: 12, attempted: 9, reached: 6, wrong_number: 2, not_qualified: 3, closed: { out_of_area: 4, not_interested: 1 } }),
      counts({ campaign_id: "b", leads: 8, attempted: 5, reached: 2, closed: { out_of_area: 1, spam: 0 } }),
    ]);
    expect(items.map((i) => [i.id, i.text])).toEqual([
      ["lead_outcome:reached", "Of 20 of our ad leads in the last 28 days, 14 were called and 8 were reached."],
      ["lead_outcome:not_qualified", "3 of 20 of our ad leads in the last 28 days did not meet a hard requirement of the opening."],
      ["lead_outcome:wrong_number", "2 of the 14 ad leads we called in the last 28 days had a wrong number."],
      ["lead_outcome:closed_not_interested", "1 of 20 of our ad leads in the last 28 days were closed as: not interested."],
      ["lead_outcome:closed_out_of_area", "5 of 20 of our ad leads in the last 28 days were closed as: out of area."],
    ]);
    expect(items.every((i) => i.kind === "lead_outcome" && i.source === null)).toBe(true);
  });
});

describe("conceptResults and resultEvidence", () => {
  it("folds the org's hours by hook and scene across pages, and drops a creative whose preset names no concept", async () => {
    const page = Array.from({ length: 1000 }, () => hour("cr-1", "10", 0, 1));
    const rec = world({ hours: { pages: [page, [hour("cr-1", 2_000, 2), hour("cr-2", 500, 0), hour("cr-3", 9_999, 9)]] } });
    const concepts = await conceptResults(rec.client, ORG, new Date("2026-10-18T18:00:00.000Z"));
    expect(concepts.map((c) => [c.preset_key, c.spend_cents, c.leads, c.cost_per_lead_cents])).toEqual([
      ["life_first+home_street", 500, 0, null],
      ["pay_first+cab_pov", 12_000, 2, 6_000],
    ]);
    expect(rec.forTable("ads_ad_spend_hourly")).toHaveLength(2);
    expect(rec.forTable("ads_creatives")[0]!.ops).toContainEqual({ method: "in", args: ["id", ["cr-1", "cr-2", "cr-3"]] });
    expectOrgScoped(rec, ORG);
  });

  it("asks for creatives a hundred ids at a time", async () => {
    const rec = world({ hours: Array.from({ length: 250 }, (_, i) => hour(`cr-${i}`, 1, 0)) });
    await conceptResults(rec.client, ORG, new Date("2026-10-18T18:00:00.000Z"));
    expect(rec.forTable("ads_creatives").map((q) => (q.ops.find((o) => o.method === "in")!.args[1] as string[]).length)).toEqual([100, 100, 50]);
  });

  it("writes a concept that spent as one sentence, and one that spent nothing as none", async () => {
    const rec = world({ hours: [hour("cr-1", 12_345, 1, 4200), hour("cr-2", 0, 0)] });
    const items = resultEvidence(await conceptResults(rec.client, ORG, new Date("2026-10-18T18:00:00.000Z")));
    expect(items).toEqual([{
      id: "our_result:pay_first_cab_pov", kind: "our_result", source: null,
      text: expect.stringMatching(/^Our ads with hook pay_first \(.+\) and scene cab_pov \(.+\) spent \$123\.45 in the last 28 days over 4200 impressions and brought 1 lead, \$123\.45 per lead\.$/),
    }]);
    const none = resultEvidence(await conceptResults(world({ hours: [hour("cr-2", 700, 0)] }).client, ORG, new Date("2026-10-18T18:00:00.000Z")));
    expect(none[0]!.text).toMatch(/spent \$7\.00 in the last 28 days over 1000 impressions and brought no lead\.$/);
  });
});
