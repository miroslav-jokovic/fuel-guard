import { describe, expect, it } from "vitest";
import { MONITOR_RULES, monitorChecks, type MonitorCampaignFacts, type MonitorFacts } from "./monitorChecks.js";
import { rulesSpec } from "./adsRulesSpec.js";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "./settingsContract.js";

/**
 * B5b's decision table. §4R Monitor L3: "each rule fires exactly at its threshold and minimum spend, never on
 * a learning-phase ad set except caps". Each boundary is tested at −1/0/+1 of the setting it reads.
 */

const SETTINGS: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  limits: { ...ADS_SETTINGS_UNSET.limits, monthly_cap_cents: { meta: 300_000 } },
  auto_pause: { cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true, pause_when_filled: true },
};

const camp = (over: Partial<MonitorCampaignFacts> = {}): MonitorCampaignFacts => ({
  campaign_id: "c1", state: "live", daily_budget_cents: 5_000, today_spend_cents: 1_000,
  lifetime_spend_cents: 2_000, lifetime_leads: 1, learning: "not_learning", frequency_7d: 1.5, ...over,
});
const facts = (campaigns: MonitorCampaignFacts[], over: Partial<MonitorFacts> = {}): MonitorFacts =>
  ({ platform: "meta", month_spend_cents: 50_000, platform_month_spend_cents: 50_000, campaigns, ...over });
const rule = (c: MonitorCampaignFacts, s: AdsSettings = SETTINGS, f: Partial<MonitorFacts> = {}) => monitorChecks(s, facts([c], f))[0]?.rule ?? null;

describe("monitorChecks — the auto-pause rules (B5b)", () => {
  it("a healthy campaign is left alone", () => {
    expect(monitorChecks(SETTINGS, facts([camp()]))).toEqual([]);
  });

  it("overspend: the month past the platform's cap pauses EVERY delivering campaign on it, at a cent over and not at the cap", () => {
    const two = [camp(), camp({ campaign_id: "c2", state: "launching" }), camp({ campaign_id: "c3", state: "paused" })];
    expect(monitorChecks(SETTINGS, facts(two, { month_spend_cents: 300_001 })).map((b) => [b.campaign_id, b.rule, b.alert, b.measured, b.threshold]))
      .toEqual([["c1", "monthly_cap", "ads_overspend", 300_001, 300_000], ["c2", "monthly_cap", "ads_overspend", 300_001, 300_000]]);
    expect(rule(camp(), SETTINGS, { month_spend_cents: 300_000 })).toBeNull();
    expect(rule(camp(), SETTINGS, { month_spend_cents: 299_999 })).toBeNull();
  });

  it("the month reads the larger of our fold and the platform's own figure, and an unreadable platform figure falls back to ours", () => {
    expect(rule(camp(), SETTINGS, { month_spend_cents: 10, platform_month_spend_cents: 300_001 })).toBe("monthly_cap");
    expect(rule(camp(), SETTINGS, { month_spend_cents: 300_001, platform_month_spend_cents: null })).toBe("monthly_cap");
  });

  it("daily cap: today's spend past the campaign's daily budget, only while pause_at_daily_cap is on", () => {
    expect([4_999, 5_000, 5_001].map((t) => rule(camp({ today_spend_cents: t })))).toEqual([null, null, "daily_cap"]);
    expect(rule(camp({ today_spend_cents: 5_001 }), { ...SETTINGS, auto_pause: { ...SETTINGS.auto_pause, pause_at_daily_cap: false } })).toBeNull();
  });

  it("zero-lead spend past the minimum fires, and at or below it does not; one lead stops it", () => {
    expect([7_499, 7_500, 7_501].map((s) => rule(camp({ lifetime_leads: 0, lifetime_spend_cents: s })))).toEqual([null, null, "no_lead_spend"]);
    expect(rule(camp({ lifetime_leads: 1, lifetime_spend_cents: 7_501 }))).toBeNull();
    expect(monitorChecks(SETTINGS, facts([camp({ lifetime_leads: 0, lifetime_spend_cents: 7_501 })]))[0]?.alert).toBe("ads_no_leads");
  });

  it("cost per lead: judged only from the minimum lead count, and fires a cent over the setting", () => {
    // 3 leads at $42.00 each = 12,600; one cent more over 3 leads is 12,601 → 4,200.33 > 4,200.
    expect([12_600, 12_601].map((s) => rule(camp({ lifetime_leads: 3, lifetime_spend_cents: s })))).toEqual([null, "cpl_max"]);
    expect(rule(camp({ lifetime_leads: 2, lifetime_spend_cents: 50_000 }))).toBeNull();
    expect(monitorChecks(SETTINGS, facts([camp({ lifetime_leads: 3, lifetime_spend_cents: 12_601 })]))[0]?.alert).toBeNull();
  });

  it("fatigue: a 7-day frequency over the setting fires, at it does not, and an unread frequency never does", () => {
    expect([4, 4.01].map((f) => rule(camp({ frequency_7d: f })))).toEqual([null, "frequency_max"]);
    expect(rule(camp({ frequency_7d: null }))).toBeNull();
  });

  it("a learning-phase ad set is not paused except by a cap — and an unread stage is held the same way", () => {
    for (const learning of ["learning", "unknown"] as const) {
      expect(rule(camp({ learning, lifetime_leads: 0, lifetime_spend_cents: 90_000, frequency_7d: 9 }))).toBeNull();
      expect(rule(camp({ learning, today_spend_cents: 5_001 }))).toBe("daily_cap");
      expect(rule(camp({ learning }), SETTINGS, { month_spend_cents: 300_001 })).toBe("monthly_cap");
    }
  });

  it("a campaign breaching several rules is paused once, for the most serious (caps first)", () => {
    const worst = camp({ today_spend_cents: 9_000, lifetime_leads: 0, lifetime_spend_cents: 90_000, frequency_7d: 9 });
    expect(monitorChecks(SETTINGS, facts([worst])).map((b) => b.rule)).toEqual(["daily_cap"]);
    expect(MONITOR_RULES.slice(0, 2)).toEqual(["monthly_cap", "daily_cap"]);
  });

  it("unset settings check nothing but the daily cap, the one switch the defaults leave on — the same set Meta's rules carry", () => {
    const wild = camp({ today_spend_cents: 1, lifetime_leads: 0, lifetime_spend_cents: 99_999_999, frequency_7d: 50 });
    expect(rule(wild, ADS_SETTINGS_UNSET, { month_spend_cents: 99_999_999 })).toBeNull();
    expect(rule({ ...wild, today_spend_cents: 5_001 }, ADS_SETTINGS_UNSET)).toBe("daily_cap");
    expect(rulesSpec(ADS_SETTINGS_UNSET.auto_pause, "META").map((r) => r.key)).toEqual(["daily_cap"]);
  });

  it("judges only what may be delivering: paused, pausing and archived campaigns are not paused again", () => {
    for (const state of ["paused", "pausing", "archived", "failed", "draft"] as const) {
      expect(rule(camp({ state, today_spend_cents: 9_000 }))).toBeNull();
    }
  });
});
