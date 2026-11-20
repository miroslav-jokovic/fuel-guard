import { describe, expect, it } from "vitest";
import type { LeadSourceOutcome, LeadSources } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { adsLeadCostView } from "./leadCostView.js";

/**
 * V7d's read: where each input of the cost report comes from, over a fake that APPLIES `eq`, `in`, `gte` and `lt`
 * (the recorder alone does not filter — memory supabase-recorder-does-not-filter), with a second carrier's rows in
 * every table. The fold itself is shared `leadCostReport.test.ts`.
 */

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0b000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-19T18:00:00Z");
const T = "2026-11-10T15:00:00.000Z";

function applying(rows: Array<Record<string, unknown>>) {
  return (q: RecordedQuery) => {
    let out = rows;
    for (const op of q.ops) {
      const [col, a] = op.args as [string, unknown];
      if (op.method === "eq") out = out.filter((r) => r[col] === a);
      if (op.method === "in") out = out.filter((r) => (a as unknown[]).includes(r[col]));
      if (op.method === "gte") out = out.filter((r) => Date.parse(String(r[col])) >= Date.parse(String(a)));
      if (op.method === "lt") out = out.filter((r) => Date.parse(String(r[col])) < Date.parse(String(a)));
    }
    return out;
  };
}

const campaign = (org: string, id: string, ads: Array<{ creative_id: string; meta_ad_id: string }>) => ({
  org_id: org, id, connection_id: `${org}-conn`, platform_refs: { ads: ads.map((a) => ({ ...a, language: "en" })) },
});
const hour = (org: string, campaign_id: string, hourAt: string, spend_cents: number, currency = "USD") => ({ org_id: org, campaign_id, hour: hourAt, spend_cents, currency });
const adHour = (org: string, creative_id: string, hourAt: string, spend_cents: number) => ({ org_id: org, creative_id, meta_ad_id: "1", hour: hourAt, spend_cents });

function world(over: { hours?: Array<Record<string, unknown>> } = {}) {
  return createSupabaseRecorder({
    tables: {
      ads_platform_connections: applying([{ org_id: ORG, id: `${ORG}-conn`, provider: "meta" }, { org_id: OTHER, id: `${OTHER}-conn`, provider: "meta" }]),
      ads_campaigns: applying([
        campaign(ORG, "c1", [{ creative_id: "cr-pay", meta_ad_id: "111" }, { creative_id: "cr-old", meta_ad_id: "222" }]),
        campaign(OTHER, "c9", [{ creative_id: "cr-theirs", meta_ad_id: "999" }]),
      ]),
      ads_creatives: applying([
        { org_id: ORG, id: "cr-pay", preset_version_id: "v-pay" },
        { org_id: ORG, id: "cr-old", preset_version_id: "v-old" },
        { org_id: ORG, id: "cr-retired", preset_version_id: "v-pay" },
        { org_id: OTHER, id: "cr-theirs", preset_version_id: "v-theirs" },
      ]),
      ad_concept_preset_versions: applying([
        { org_id: ORG, id: "v-pay", recipe: { hook_family: "pay_first", scene_family: "cab_pov" } },
        { org_id: ORG, id: "v-old", recipe: {} },
        { org_id: OTHER, id: "v-theirs", recipe: { hook_family: "proof", scene_family: "home_street" } },
      ]),
      ads_spend_hourly: applying(over.hours ?? [
        hour(ORG, "c1", "2026-11-01T05:00:00Z", 1_000), // the first hour of 11/01 in Chicago: in
        hour(ORG, "c1", "2026-11-01T04:00:00Z", 50_000), // 10/31 23:00 in Chicago: out
        hour(ORG, "c1", "2026-11-30T23:00:00Z", 2_000), // 11/30 17:00 in Chicago: in
        hour(ORG, "c1", "2026-12-01T06:00:00Z", 70_000), // 12/01 00:00 in Chicago: out
        hour(OTHER, "c9", "2026-11-10T00:00:00Z", 900_000),
      ]),
      ads_ad_spend_hourly: applying([
        adHour(ORG, "cr-pay", "2026-11-05T15:00:00Z", 1_500),
        adHour(ORG, "cr-old", "2026-11-05T15:00:00Z", 500),
        adHour(ORG, "cr-retired", "2026-11-05T16:00:00Z", 400),
        adHour(OTHER, "cr-theirs", "2026-11-05T15:00:00Z", 800_000),
      ]),
    },
  });
}

let n = 0;
const lead = (over: Partial<LeadSourceOutcome> = {}): LeadSourceOutcome => ({
  lead_id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, channel: "meta", campaign_id: "c1", platform_ad_ref: "111",
  arrived_at: T, reached: {}, ...over,
});
function sources(leads: LeadSourceOutcome[]) {
  const asked: Array<[string, string, string]> = [];
  const s: LeadSources = { everyLeadBetween: async (org, from, to) => { asked.push([org, from, to]); return leads; } };
  return { s, asked };
}

describe("adsLeadCostView (V7d)", () => {
  it("asks for the leads of the carrier's days, as half-open instants in its zone", async () => {
    const { s, asked } = sources([]);
    const v = await adsLeadCostView(world().client as never, s, ORG, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    expect(asked).toEqual([[ORG, "2026-11-01T05:00:00.000Z", "2026-12-01T06:00:00.000Z"]]);
    expect([v.from, v.to, v.zone]).toEqual(["2026-11-01", "2026-11-30", "America/Chicago"]);
  });

  it("spend is this carrier's hours inside the days, under the connection's platform, in its currency", async () => {
    const rec = world();
    const v = await adsLeadCostView(rec.client as never, sources([lead({ reached: { qualified: T } })]).s, ORG, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    expect(v.by_source).toEqual([expect.objectContaining({ key: "meta", spend_cents: 3_000, qualified: 1, cost_per_qualified_cents: 3_000 })]);
    expect(v.currency).toBe("USD");
    expectOrgScoped(rec, ORG);
  });

  it("a lead's ad is found in the publisher's record and named by its creative's concept; spend by angle from the ad hours", async () => {
    const v = await adsLeadCostView(world().client as never, sources([
      lead({ platform_ad_ref: "111", reached: { hired: T } }), lead({ platform_ad_ref: "222" }), lead({ platform_ad_ref: "999" }),
    ]).s, ORG, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    const by = Object.fromEntries(v.by_angle.map((a) => [a.key, a]));
    // cr-retired is no longer in the record, but its hour still names its creative, and that creative its preset
    expect(by["pay_first+cab_pov"]).toMatchObject({ leads: 1, hired: 1, spend_cents: 1_900, cost_per_hire_cents: 1_900 });
    expect(by["no_angle_named"]).toMatchObject({ leads: 1, spend_cents: 500 });
    // another carrier's ad id is never found in this carrier's record
    expect(by["ad_not_known"]).toMatchObject({ leads: 1, spend_cents: null });
    expect(v.ad_spend_unattributed_cents).toBe(600);
    expect(JSON.stringify(v)).not.toContain("proof+home_street");
  });

  it("nothing spent: currency null and every cost null, counts still shown", async () => {
    const v = await adsLeadCostView(world({ hours: [] }).client as never, sources([lead({ channel: "walk_in", campaign_id: null, platform_ad_ref: null })]).s, ORG, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    expect(v.currency).toBeNull();
    expect(v.total).toMatchObject({ leads: 1, spend_cents: null, cost_per_qualified_cents: null });
  });

  it("refuses to add two currencies into one number", async () => {
    const hours = [hour(ORG, "c1", "2026-11-02T15:00:00Z", 1, "USD"), hour(ORG, "c1", "2026-11-02T16:00:00Z", 1, "CAD")];
    await expect(adsLeadCostView(world({ hours }).client as never, sources([]).s, ORG, { from: "2026-11-01", to: "2026-11-30" }, NOW)).rejects.toThrow(/more than one currency/);
  });
});
