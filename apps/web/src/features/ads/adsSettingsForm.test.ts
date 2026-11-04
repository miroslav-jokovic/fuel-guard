import { describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { toFormValues, toSettings } from "./adsSettingsForm";

/** Settings › Ads control's form ↔ the stored settings (E1a): blank is "not set", dollars are cents, the rest passes through. */
const SAVED: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  limits: { monthly_cap_cents: { meta: 300_000 }, daily_max_cents: 10_000, lifetime_max_cents: 150_000, max_raise_pct: 25, max_raise_cents: 5_000 },
  alerts: { recipients: { ads_overspend: ["0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"] }, uncontacted_lead_minutes: 30 },
  budgets: { ...ADS_SETTINGS_UNSET.budgets, agents_enabled: { copywriter: true } },
};

describe("adsSettingsForm", () => {
  it("round-trips a saved version unchanged", () => {
    expect(toSettings(SAVED, toFormValues(SAVED))).toEqual({ ok: true, settings: SAVED });
  });

  it("shows dollars, not cents, and blank for not set", () => {
    const v = toFormValues(SAVED);
    expect([v.monthly_cap.meta, v.monthly_cap.tiktok, v.daily_max, v.cpl_max]).toEqual(["3000", "", "100", ""]);
  });

  it("stores typed dollars as cents, with cents and thousands separators", () => {
    const v = { ...toFormValues(SAVED), daily_max: "$1,250.50", monthly_cap: { ...toFormValues(SAVED).monthly_cap, tiktok: "800" } };
    const out = toSettings(SAVED, v);
    expect(out.ok && out.settings.limits.daily_max_cents).toBe(125_050);
    expect(out.ok && out.settings.limits.monthly_cap_cents).toEqual({ meta: 300_000, tiktok: 80_000 });
  });

  it("an emptied field becomes not set (null), never zero", () => {
    const out = toSettings(SAVED, { ...toFormValues(SAVED), daily_max: "  " });
    expect(out.ok && out.settings.limits.daily_max_cents).toBeNull();
  });

  it("an emptied platform cap leaves that platform without a cap", () => {
    const v = toFormValues(SAVED);
    const out = toSettings(SAVED, { ...v, monthly_cap: { ...v.monthly_cap, meta: "" } });
    expect(out.ok && out.settings.limits.monthly_cap_cents).toEqual({});
  });

  it.each([
    ["zero dollars", { daily_max: "0" }, "limits.daily_max_cents"],
    ["a word", { lifetime_max: "lots" }, "limits.lifetime_max_cents"],
    ["a raise of 600 %", { max_raise_pct: "600" }, "limits.max_raise_pct"],
    ["six tries", { max_regenerations: "6" }, "budgets.max_regenerations"],
    ["no tries typed", { max_regenerations: "" }, "budgets.max_regenerations"],
  ])("refuses %s, naming the field and saying why", (_n, patch, field) => {
    const out = toSettings(SAVED, { ...toFormValues(SAVED), ...patch });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.field).toBe(field);
      expect(out.message).not.toBe("Check the values on this page.");
    }
  });

  it("keeps what this page does not edit — the alerts and their recipients", () => {
    const out = toSettings(SAVED, { ...toFormValues(SAVED), daily_max: "90" });
    expect(out.ok && out.settings.alerts).toEqual(SAVED.alerts);
  });

  it("an agent switched on is saved on; one never switched on stays off", () => {
    const v = toFormValues(SAVED);
    expect([v.agents_enabled.copywriter, v.agents_enabled.checker]).toEqual([true, false]);
    const out = toSettings(SAVED, { ...v, agents_enabled: { ...v.agents_enabled, checker: true } });
    expect(out.ok && out.settings.budgets.agents_enabled).toEqual({ copywriter: true, checker: true });
  });
});
