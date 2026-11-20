import { describe, expect, it } from "vitest";
import { ANGLE_NOT_NAMED, ANGLE_UNKNOWN_AD, angleLabel, countsAsQualified, foldLeadCostReport, type LeadCostInput } from "./leadCostReport.js";
import type { LeadSourceOutcome } from "./leadOutcomes.js";

/** V7d: the cost report's fold, row by row. */

let n = 0;
const lead = (over: Partial<LeadSourceOutcome> & { reached?: LeadSourceOutcome["reached"] } = {}): LeadSourceOutcome => ({
  lead_id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, channel: "meta", campaign_id: "c1", platform_ad_ref: "111",
  arrived_at: "2026-11-02T15:00:00.000Z", reached: {}, ...over,
});
const T = "2026-11-03T15:00:00.000Z";
const input = (over: Partial<LeadCostInput>): LeadCostInput => ({
  leads: [], ads: new Map(), platformSpendCents: new Map(), angleSpendCents: new Map(), ...over,
});

describe("countsAsQualified (Q-APX26 (a))", () => {
  it("a recruiter's qualify or any later step; never the form's own answers", () => {
    expect(countsAsQualified(lead())).toBe(false);
    expect(countsAsQualified(lead({ reached: { contacted: T } }))).toBe(false);
    expect(countsAsQualified(lead({ reached: { not_qualified: T } }))).toBe(false);
    for (const stage of ["qualified", "converted", "applied", "hired"] as const) expect(countsAsQualified(lead({ reached: { [stage]: T } }))).toBe(true);
  });
});

describe("foldLeadCostReport", () => {
  it("by source: counts, spend, cost per qualified and per hire, rounded to the cent", () => {
    const r = foldLeadCostReport(input({
      leads: [lead({ reached: { qualified: T } }), lead({ reached: { converted: T, hired: T } }), lead(), lead({ reached: { qualified: T } })],
      platformSpendCents: new Map([["meta", 10_000]]),
    }));
    expect(r.by_source).toEqual([{ key: "meta", label: "Meta ad", leads: 4, qualified: 3, hired: 1, spend_cents: 10_000, cost_per_qualified_cents: 3333, cost_per_hire_cents: 10_000 }]);
  });

  it("a source with no spend shows null, never $0, and no cost", () => {
    const r = foldLeadCostReport(input({ leads: [lead({ channel: "phone_call", campaign_id: null, platform_ad_ref: null, reached: { qualified: T } })] }));
    expect(r.by_source[0]).toMatchObject({ key: "phone_call", spend_cents: null, cost_per_qualified_cents: null, cost_per_hire_cents: null, qualified: 1 });
  });

  it("no qualified lead or no hire yet: that cost is null, not infinite", () => {
    const r = foldLeadCostReport(input({ leads: [lead()], platformSpendCents: new Map([["meta", 500]]) }));
    expect(r.by_source[0]).toMatchObject({ cost_per_qualified_cents: null, cost_per_hire_cents: null, spend_cents: 500 });
  });

  it("money spent on a platform with no lead still shows", () => {
    const r = foldLeadCostReport(input({ platformSpendCents: new Map([["meta", 2_500]]) }));
    expect(r.by_source).toEqual([expect.objectContaining({ key: "meta", leads: 0, spend_cents: 2_500 })]);
  });

  it("by angle: an ad's lead goes to its creative's angle, with the ad spend of that angle", () => {
    const r = foldLeadCostReport(input({
      leads: [lead({ platform_ad_ref: "111", reached: { qualified: T } }), lead({ platform_ad_ref: "222" }), lead({ platform_ad_ref: "333" })],
      ads: new Map([["111", { angle: "pay_first+cab_pov" }], ["222", { angle: null }]]),
      platformSpendCents: new Map([["meta", 9_000]]),
      angleSpendCents: new Map([["pay_first+cab_pov", 6_000], [null, 2_000]]),
    }));
    const by = Object.fromEntries(r.by_angle.map((a) => [a.key, a]));
    expect(by["pay_first+cab_pov"]).toMatchObject({ leads: 1, qualified: 1, spend_cents: 6_000, cost_per_qualified_cents: 6_000 });
    expect(by[ANGLE_NOT_NAMED]).toMatchObject({ leads: 1, spend_cents: 2_000, label: "No angle named" });
    expect(by[ANGLE_UNKNOWN_AD]).toMatchObject({ leads: 1, spend_cents: null, label: "Ad not known" });
    expect(r.ad_spend_unattributed_cents).toBe(1_000);
  });

  it("a lead with no ad named, or not from a campaign, is never put in an angle", () => {
    const r = foldLeadCostReport(input({
      leads: [lead({ platform_ad_ref: null }), lead({ channel: "tenstreet", campaign_id: null, platform_ad_ref: null })],
    }));
    expect(r.by_angle).toEqual([expect.objectContaining({ key: ANGLE_UNKNOWN_AD, leads: 1 })]);
  });

  it("an angle with spend and no lead still shows", () => {
    const r = foldLeadCostReport(input({ angleSpendCents: new Map([["proof+home_street", 700]]) }));
    expect(r.by_angle).toEqual([expect.objectContaining({ key: "proof+home_street", leads: 0, spend_cents: 700 })]);
  });

  it("the total says no cost when a source with leads has no spend: Meta's money is not divided by Tenstreet's leads", () => {
    const mixed = foldLeadCostReport(input({
      leads: [lead({ reached: { qualified: T } }), lead({ channel: "tenstreet", campaign_id: null, platform_ad_ref: null, reached: { qualified: T } })],
      platformSpendCents: new Map([["meta", 4_000]]),
    }));
    expect(mixed.total).toMatchObject({ leads: 2, qualified: 2, spend_cents: 4_000, cost_per_qualified_cents: null, cost_per_hire_cents: null });
    const metaOnly = foldLeadCostReport(input({ leads: [lead({ reached: { qualified: T } })], platformSpendCents: new Map([["meta", 4_000]]) }));
    expect(metaOnly.total).toMatchObject({ cost_per_qualified_cents: 4_000 });
    expect(foldLeadCostReport(input({ leads: [lead()] })).total.spend_cents).toBeNull();
  });

  it("rows are ordered by leads, most first, then by key", () => {
    const r = foldLeadCostReport(input({ leads: [lead({ channel: "walk_in", campaign_id: null }), lead(), lead()] }));
    expect(r.by_source.map((s) => s.key)).toEqual(["meta", "walk_in"]);
  });
});

describe("angleLabel", () => {
  it("says the pair in office words, and the two named rows", () => {
    expect(angleLabel("pay_first+cab_pov")).toMatch(/,/);
    expect(angleLabel(ANGLE_UNKNOWN_AD)).toBe("Ad not known");
    expect(angleLabel("nonsense")).toBe("nonsense");
  });
});
