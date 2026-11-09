import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { CONCEPT_WINDOW_DAYS, campaignConcepts } from "./conceptPerformance.js";

/** The concept read (CQ3's reader): the campaign's ad hours, joined to its presets, folded — every query org-scoped. */
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const CAMP = "00000000-0000-4000-8000-00000000aa01";
const NOW = new Date("2026-11-09T18:00:00Z");
const hour = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function world(extraRows: Array<Record<string, unknown>> = []) {
  return createSupabaseRecorder({
    tables: {
      ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG }, { id: CAMP, org_id: OTHER }]),
      ads_creatives: postgrestFixture([
        { id: "c1", org_id: ORG, campaign_id: CAMP, preset_version_id: "v1" },
        { id: "c2", org_id: ORG, campaign_id: CAMP, preset_version_id: "v2" },
        { id: "c9", org_id: OTHER, campaign_id: CAMP, preset_version_id: "v1" },
      ]),
      ad_concept_preset_versions: postgrestFixture([{ id: "v1", org_id: ORG, preset_id: "p1" }, { id: "v2", org_id: ORG, preset_id: "p2" }]),
      ad_concept_presets: postgrestFixture([{ id: "p1", org_id: ORG, key: "P1" }, { id: "p2", org_id: ORG, key: "P2" }]),
      ads_ad_spend_hourly: postgrestFixture([
        { org_id: ORG, campaign_id: CAMP, creative_id: "c1", language: "en", meta_ad_id: "1", hour: hour(1), spend_cents: "1000", impressions: "100", clicks: "5", leads: "2" },
        { org_id: ORG, campaign_id: CAMP, creative_id: "c1", language: "es", meta_ad_id: "2", hour: hour(2), spend_cents: "500", impressions: "50", clicks: "1", leads: "0" },
        { org_id: ORG, campaign_id: CAMP, creative_id: "c2", language: "en", meta_ad_id: "3", hour: hour(3), spend_cents: "3000", impressions: "300", clicks: "9", leads: "1" },
        // Older than the window: not counted.
        { org_id: ORG, campaign_id: CAMP, creative_id: "c2", language: "en", meta_ad_id: "3", hour: hour(CONCEPT_WINDOW_DAYS + 2), spend_cents: "99999", impressions: "1", clicks: "1", leads: "9" },
        // Another carrier's hour on a campaign with the same id: never ours.
        { org_id: OTHER, campaign_id: CAMP, creative_id: "c9", language: "en", meta_ad_id: "4", hour: hour(1), spend_cents: "77777", impressions: "1", clicks: "1", leads: "7" },
        ...extraRows,
      ]),
    },
  });
}

describe("campaignConcepts — what each concept did, from the per-ad hours (CQ3 reader)", () => {
  it("folds this carrier's hours inside the window per preset, with cost per lead, and reads nothing of another carrier's", async () => {
    const rec = world();
    const out = await campaignConcepts(rec.client as never, ORG, CAMP, NOW);
    expect(out).toMatchObject({ campaign_id: CAMP, read_at: NOW.toISOString() });
    expect(out!.concepts.map((c) => [c.preset_key, c.spend_cents, c.leads, c.cost_per_lead_cents])).toEqual([["P1", 1500, 2, 750], ["P2", 3000, 1, 3000]]);
    expect(out!.concepts[0]!.by_language.es).toMatchObject({ spend_cents: 500, leads: 0, cost_per_lead_cents: null });
    expectOrgScoped(rec, ORG);
    const read = rec.forTable("ads_ad_spend_hourly").find((q: RecordedQuery) => q.write === null)!;
    expect(read.filters().some((f) => f.col === "hour")).toBe(true);
  });

  it("a campaign of another carrier is none, not an empty fold", async () => {
    const rec = world();
    expect(await campaignConcepts(rec.client as never, "00000000-0000-4000-8000-0000000000a3", CAMP, NOW)).toBeNull();
  });

  it("pages through more than one page of hours", async () => {
    const many = Array.from({ length: 1005 }, (_, i) => ({ org_id: ORG, campaign_id: CAMP, creative_id: "c2", language: "en", meta_ad_id: String(100 + i), hour: hour(1), spend_cents: "1", impressions: "1", clicks: "0", leads: "0" }));
    const rec = world(many);
    const out = await campaignConcepts(rec.client as never, ORG, CAMP, NOW);
    expect(out!.concepts.find((c) => c.preset_key === "P2")!.spend_cents).toBe(3000 + 1005);
    expect(rec.forTable("ads_ad_spend_hourly").filter((q: RecordedQuery) => q.write === null).length).toBeGreaterThanOrEqual(2);
  });
});
