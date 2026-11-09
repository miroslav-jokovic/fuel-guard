import { describe, expect, it } from "vitest";
import { leadQualityBreaches, medianMinutes, type LeadQualityCounts } from "./leadQuality.js";
import { ADS_LEAD_QUALITY_DEFAULT, ADS_SETTINGS_UNSET, adsSettingsSchema, leadQualityOf } from "./settingsContract.js";

const row = (over: Partial<LeadQualityCounts>): LeadQualityCounts => ({
  campaign_id: "c1", leads: 20, attempted: 10, wrong_number: 0, reached: 5, not_qualified: 0, median_first_attempt_minutes: 7, ...over,
});

describe("leadQualityBreaches (LQ3, Q-AD51 (a))", () => {
  it("waits until enough leads have been tried: 9 attempts with every one a wrong number says nothing", () => {
    expect(leadQualityBreaches([row({ attempted: 9, wrong_number: 9 })], ADS_LEAD_QUALITY_DEFAULT)).toEqual([]);
  });

  it("wrong numbers are a share of the ATTEMPTED leads, at or above the threshold", () => {
    expect(leadQualityBreaches([row({ attempted: 10, wrong_number: 4 })], ADS_LEAD_QUALITY_DEFAULT))
      .toEqual([{ campaign_id: "c1", rule: "wrong_numbers", measured_pct: 40, threshold_pct: 40, part: 4, whole: 10 }]);
    expect(leadQualityBreaches([row({ attempted: 10, wrong_number: 3 })], ADS_LEAD_QUALITY_DEFAULT)).toEqual([]);
  });

  it("not qualified is a share of ALL the window's leads", () => {
    expect(leadQualityBreaches([row({ leads: 20, not_qualified: 8 })], ADS_LEAD_QUALITY_DEFAULT))
      .toEqual([{ campaign_id: "c1", rule: "not_qualified", measured_pct: 40, threshold_pct: 40, part: 8, whole: 20 }]);
    expect(leadQualityBreaches([row({ leads: 20, not_qualified: 7 })], ADS_LEAD_QUALITY_DEFAULT)).toEqual([]);
  });

  it("both rules can ring for one campaign; the switch off rings none", () => {
    const bad = row({ wrong_number: 5, not_qualified: 10 });
    expect(leadQualityBreaches([bad], ADS_LEAD_QUALITY_DEFAULT).map((b) => b.rule)).toEqual(["wrong_numbers", "not_qualified"]);
    expect(leadQualityBreaches([bad], { ...ADS_LEAD_QUALITY_DEFAULT, enabled: false })).toEqual([]);
  });
});

describe("the lead-quality settings group", () => {
  it("a version saved before the group existed reads as the ruled defaults, on", () => {
    expect(leadQualityOf(ADS_SETTINGS_UNSET)).toEqual({ enabled: true, min_attempted: 10, wrong_number_pct: 40, not_qualified_pct: 40 });
    expect(adsSettingsSchema.safeParse(ADS_SETTINGS_UNSET).success).toBe(true);
  });

  it("a saved group is the one in force, and its bounds are held", () => {
    const saved = { ...ADS_SETTINGS_UNSET, lead_quality: { enabled: false, min_attempted: 20, wrong_number_pct: 30, not_qualified_pct: 50 } };
    expect(leadQualityOf(adsSettingsSchema.parse(saved))).toEqual(saved.lead_quality);
    expect(adsSettingsSchema.safeParse({ ...saved, lead_quality: { ...saved.lead_quality, wrong_number_pct: 101 } }).success).toBe(false);
    expect(adsSettingsSchema.safeParse({ ...saved, lead_quality: { ...saved.lead_quality, min_attempted: 0 } }).success).toBe(false);
  });
});

describe("medianMinutes", () => {
  it("is null for none, the middle for an odd count, the rounded mean of the two middles for an even one", () => {
    expect([medianMinutes([]), medianMinutes([9, 1, 5]), medianMinutes([1, 2, 4, 10])]).toEqual([null, 5, 3]);
  });
});
