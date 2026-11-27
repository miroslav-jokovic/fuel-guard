import { describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, type LeadSourceOutcome, type LeadSources } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { adsConversionLeadsView } from "./conversionLeadsView.js";

/**
 * V7e's read: the two windows it asks recruiting for, Meta's channel only, and coverage from the events Meta
 * accepted — over a fake that APPLIES `eq` and `gte`, with another carrier's rows beside this one's. The checks
 * themselves are shared `conversionLeads.test.ts`.
 */
const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0b000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-20T15:00:00.000Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function applying(rows: Array<Record<string, unknown>>) {
  return (q: RecordedQuery) => {
    let out = rows;
    for (const op of q.ops) {
      const [col, a] = op.args as [string, unknown];
      if (op.method === "eq") out = out.filter((r) => r[col] === a);
      if (op.method === "gte") out = out.filter((r) => Date.parse(String(r[col])) >= Date.parse(String(a)));
    }
    return out;
  };
}
const ev = (org: string, n: number, stage: string, status: string, created = "2026-11-18T00:00:00Z") =>
  ({ id: `${org}-${n}-${stage}`, org_id: org, provider: "meta", source_event_ref: `${id(n)}:${stage}`, status, created_at: created });

function world(feed: { enabled: boolean; dataset_id: string | null }) {
  return createSupabaseRecorder({
    tables: {
      ads_outcome_events: applying([
        ev(ORG, 1, "lead", "sent"),
        ev(ORG, 2, "lead", "skipped"), ev(ORG, 2, "contacted", "sent"),
        ev(ORG, 3, "lead", "failed"),
        ev(OTHER, 4, "lead", "sent"),
      ]),
      ads_settings_versions: [{ id: "v1", version: 1, settings: { ...ADS_SETTINGS_UNSET, outcome_feed: feed }, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }],
    },
  });
}
const lead = (n: number, channel = "meta"): LeadSourceOutcome => ({ lead_id: id(n), channel, campaign_id: "c", platform_ad_ref: null, arrived_at: "2026-11-17T00:00:00.000Z", reached: {} });

describe("adsConversionLeadsView (V7e)", () => {
  it("asks recruiting for the last 30 days and the 29-to-58-day cohort, and counts Meta's leads only", async () => {
    const asked: Array<[string, string, string]> = [];
    const sources: LeadSources = {
      everyLeadBetween: async (org, from, to) => {
        asked.push([org, from, to]);
        return from === "2026-10-21T15:00:00.000Z" ? [lead(1), lead(2), lead(3), lead(4), lead(9, "phone_call")] : [];
      },
    };
    const rec = world({ enabled: true, dataset_id: "770000000000001" });
    const v = await adsConversionLeadsView(rec.client as never, sources, ORG, NOW);
    expect(asked).toEqual([
      [ORG, "2026-10-21T15:00:00.000Z", "2026-11-20T15:00:00.000Z"],
      [ORG, "2026-09-23T15:00:00.000Z", "2026-10-22T15:00:00.000Z"],
    ]);
    // Leads 1 (own event) and 2 (a later stage) are covered; 3 failed; 4's event is another carrier's.
    expect(v.checks.find((c) => c.key === "coverage")!.measured).toContain("2 of 4");
    expect(v.checks.find((c) => c.key === "volume")!.measured).toContain("4 Meta leads");
    expect(v.checks.find((c) => c.key === "feed")!.met).toBe(true);
    expect(v.offered).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  it("reads the feed's switch from the settings in force", async () => {
    const sources: LeadSources = { everyLeadBetween: async () => [] };
    const v = await adsConversionLeadsView(world({ enabled: false, dataset_id: null }).client as never, sources, ORG, NOW);
    expect(v.checks.find((c) => c.key === "feed")!.met).toBe(false);
  });
});
