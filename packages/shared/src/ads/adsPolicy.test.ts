import { describe, expect, it } from "vitest";
import { ADS_AUTHORITY, checkSpend, isSafeDirection, mayAct, needsSecondApprover, type SpendRequest } from "./adsPolicy.js";
import { ADS_SETTINGS_UNSET, ADS_ALERT_CATEGORIES, adsSettingsSchema, type AdsSettings } from "./settingsContract.js";

const settings = (patch: Partial<AdsSettings["limits"]> = {}, approvals: Partial<AdsSettings["approvals"]> = {}): AdsSettings => ({
  ...ADS_SETTINGS_UNSET,
  limits: {
    monthly_cap_cents: { meta: 300_000 },
    daily_max_cents: 10_000,
    lifetime_max_cents: 150_000,
    max_raise_pct: 25,
    max_raise_cents: 5_000,
    ...patch,
  },
  approvals: { ...ADS_SETTINGS_UNSET.approvals, ...approvals },
});

// $3,000 cap; nothing spent; no other campaign; 30 days left: a $100/day launch forecasts exactly $3,000.
const launch = (patch: Partial<SpendRequest> = {}): SpendRequest => ({
  act: "launch", platform: "meta", daily_cents: 10_000, lifetime_cents: 100_000, current_daily_cents: null,
  month_to_date_cents: 0, other_live_daily_cents: 0, days_left_in_month: 30,
  account_limit_cents: 300_000, kill_switch: false, ...patch,
});
const refusals = (s: AdsSettings, r: SpendRequest) => { const v = checkSpend(s, r); return v.ok ? [] : v.refusals; };

describe("checkSpend — the monthly cap is a forecast to month end", () => {
  it("a launch whose forecast lands exactly on the cap is allowed", () => {
    expect(checkSpend(settings(), launch())).toEqual({ ok: true, forecast_cents: 300_000, cap_cents: 300_000 });
  });
  it("one cent under the cap is allowed and one cent over is refused (cap −1 / 0 / +1)", () => {
    expect(checkSpend(settings({ monthly_cap_cents: { meta: 300_001 } }), launch()).ok).toBe(true);
    expect(refusals(settings({ monthly_cap_cents: { meta: 299_999 } }), launch({ account_limit_cents: 299_999 }))).toEqual(["monthly_cap_forecast"]);
  });
  it("spend so far and the other live campaigns count against the same cap", () => {
    expect(refusals(settings(), launch({ month_to_date_cents: 1 }))).toEqual(["monthly_cap_forecast"]);
    expect(refusals(settings(), launch({ other_live_daily_cents: 1 }))).toEqual(["monthly_cap_forecast"]);
  });
  it("on the last day of the month only today's budget is forecast", () => {
    expect(checkSpend(settings(), launch({ days_left_in_month: 1, month_to_date_cents: 290_000 })).ok).toBe(true);
    expect(refusals(settings(), launch({ days_left_in_month: 1, month_to_date_cents: 290_001 }))).toEqual(["monthly_cap_forecast"]);
  });
  it("a platform with no cap of its own cannot launch, whatever another platform's cap is", () => {
    expect(refusals(settings(), launch({ platform: "tiktok" }))).toContain("caps_not_set");
  });
});

describe("checkSpend — the per-campaign limits", () => {
  it("daily max: at the max allowed, a cent over refused", () => {
    expect(checkSpend(settings({ daily_max_cents: 10_000 }), launch()).ok).toBe(true);
    expect(refusals(settings({ daily_max_cents: 9_999 }), launch())).toEqual(["daily_over_max"]);
  });
  it("lifetime max: at the max allowed, a cent over refused; a lifetime below one day refused", () => {
    expect(checkSpend(settings(), launch({ lifetime_cents: 150_000 })).ok).toBe(true);
    expect(refusals(settings(), launch({ lifetime_cents: 150_001 }))).toEqual(["lifetime_over_max"]);
    expect(refusals(settings(), launch({ lifetime_cents: 9_999 }))).toEqual(["lifetime_below_daily"]);
  });
});

describe("checkSpend — nothing is in force until someone saves it", () => {
  it("the unset settings refuse every launch", () => {
    expect(refusals(ADS_SETTINGS_UNSET, launch())).toContain("caps_not_set");
  });
  it("the kill switch refuses, alongside anything else that is wrong", () => {
    expect(refusals(settings(), launch({ kill_switch: true, month_to_date_cents: 1 }))).toEqual(["kill_switch_on", "monthly_cap_forecast"]);
  });
  it("the platform's account limit must be read, and no looser than our cap (fence 3)", () => {
    expect(refusals(settings(), launch({ account_limit_cents: null }))).toEqual(["account_limit_unknown"]);
    expect(refusals(settings(), launch({ account_limit_cents: 300_001 }))).toEqual(["account_limit_above_cap"]);
    expect(checkSpend(settings(), launch({ account_limit_cents: 300_000 })).ok).toBe(true);
  });
});

describe("checkSpend — raises", () => {
  const raise = (from: number, to: number) => launch({ act: "raise_budget", current_daily_cents: from, daily_cents: to, days_left_in_month: 1 });
  it("the smaller of the two bounds wins: 25 % of $40 is $10, under the $50 bound", () => {
    expect(checkSpend(settings(), raise(4_000, 5_000)).ok).toBe(true);
    expect(refusals(settings(), raise(4_000, 5_001))).toEqual(["raise_over_limit"]);
  });
  it("the dollar bound binds when the percentage would allow more", () => {
    expect(checkSpend(settings({ max_raise_pct: 500 }), raise(5_000, 10_000)).ok).toBe(true);
    expect(refusals(settings({ max_raise_pct: 500, max_raise_cents: 4_999 }), raise(5_000, 10_000))).toEqual(["raise_over_limit"]);
  });
  it("with no raise limit set, no raise is allowed; a 'raise' to the same or less is not a raise", () => {
    expect(refusals(settings({ max_raise_pct: null, max_raise_cents: null }), raise(4_000, 4_001))).toEqual(["raise_over_limit"]);
    expect(refusals(settings(), raise(4_000, 4_000))).toEqual(["raise_not_a_raise"]);
  });
  it("lowering is always the safe direction", () => {
    expect(isSafeDirection(5_000, 4_999)).toBe(true);
    expect(isSafeDirection(5_000, 5_000)).toBe(true);
    expect(isSafeDirection(5_000, 5_001)).toBe(false);
  });
});

describe("approvals and authority (D-AD2)", () => {
  it("a second approver is needed only above the configured amount", () => {
    expect(needsSecondApprover(settings(), 50_000)).toBe(false);
    expect(needsSecondApprover(settings({}, { second_approver_above_cents: 10_000 }), 10_000)).toBe(false);
    expect(needsSecondApprover(settings({}, { second_approver_above_cents: 10_000 }), 10_001)).toBe(true);
  });
  it("launch, raise and an area change belong to an approver alone — never the agent", () => {
    for (const act of ["launch", "raise_budget", "change_area", "edit_live_copy"] as const) {
      expect(ADS_AUTHORITY[act]).toEqual(["approver"]);
      expect(mayAct(act, "agent")).toBe(false);
    }
  });
  it("the forbidden acts have nobody who may perform them", () => {
    for (const act of ["message_a_lead", "delete_anything", "target_by_age_gender_or_zip", "change_billing_or_account_limit"] as const) {
      for (const who of ["agent", "person", "approver", "admin"] as const) expect(mayAct(act, who)).toBe(false);
    }
  });
  it("anyone on the campaign may press the kill switch; only an admin clears it", () => {
    expect(mayAct("kill_switch_on", "person")).toBe(true);
    expect(mayAct("kill_switch_off", "person")).toBe(false);
    expect(mayAct("kill_switch_off", "admin")).toBe(true);
  });
});

describe("settings contract", () => {
  it("the unset settings are a valid save", () => {
    expect(adsSettingsSchema.parse(ADS_SETTINGS_UNSET)).toEqual(ADS_SETTINGS_UNSET);
  });
  it("alert recipients are keyed by the bell's ads categories, read from the contract", () => {
    expect([...ADS_ALERT_CATEGORIES].sort()).toEqual(
      ["ads_brief", "ads_external_change", "ads_no_leads", "ads_overspend", "ads_rejected", "ads_token_expiring"],
    );
  });
  it("a cap of zero, a negative cap and more than five regenerations are refused", () => {
    const bad = (p: object) => adsSettingsSchema.safeParse({ ...ADS_SETTINGS_UNSET, ...p }).success;
    expect(bad({ limits: { ...ADS_SETTINGS_UNSET.limits, daily_max_cents: 0 } })).toBe(false);
    expect(bad({ limits: { ...ADS_SETTINGS_UNSET.limits, monthly_cap_cents: { meta: -1 } } })).toBe(false);
    expect(bad({ budgets: { ...ADS_SETTINGS_UNSET.budgets, max_regenerations: 6 } })).toBe(false);
  });
});
