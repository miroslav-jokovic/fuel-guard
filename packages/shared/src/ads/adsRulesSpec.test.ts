import { describe, expect, it } from "vitest";
import { adRuleName, rulesSpec } from "./adsRulesSpec.js";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "./settingsContract.js";

const ALL: AdsSettings["auto_pause"] = {
  cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true, pause_when_filled: true,
};
const cond = (r: ReturnType<typeof rulesSpec>[number]) =>
  r.evaluation_spec.filters.filter((f) => !["entity_type", "name", "attribution_window", "time_preset"].includes(f.field));

describe("rulesSpec — settings to Meta Automated Rules", () => {
  it("unset thresholds write no rule (the defaults keep only the daily-cap switch on); each set threshold writes exactly its own", () => {
    expect(rulesSpec(ADS_SETTINGS_UNSET.auto_pause, "META").map((r) => r.key)).toEqual(["daily_cap"]);
    expect(rulesSpec({ ...ADS_SETTINGS_UNSET.auto_pause, pause_at_daily_cap: false }, "META")).toEqual([]);
    expect(rulesSpec(ALL, "META").map((r) => r.key)).toEqual(["cpl_max", "no_lead_spend", "frequency_max", "daily_cap"]);
    expect(rulesSpec({ ...ALL, cpl_min_leads: null }, "META").map((r) => r.key)).not.toContain("cpl_max");
  });

  it("each rule fires at its threshold in cents: CPL above $42 once 3 leads exist; $75 spent with zero leads; frequency over 4; past 100% of the day", () => {
    const by = Object.fromEntries(rulesSpec(ALL, "META").map((r) => [r.key, cond(r)]));
    expect(by.cpl_max).toEqual([{ field: "cost_per_lead_fb", value: 4_200, operator: "GREATER_THAN" }, { field: "leadgen", value: 2, operator: "GREATER_THAN" }]);
    expect(by.no_lead_spend).toEqual([{ field: "spent", value: 7_500, operator: "GREATER_THAN" }, { field: "leadgen", value: 0, operator: "EQUAL" }]);
    expect(by.frequency_max).toEqual([{ field: "frequency", value: 4, operator: "GREATER_THAN" }]);
    expect(by.daily_cap).toEqual([{ field: "daily_ratio_spent", value: 1, operator: "GREATER_THAN" }]);
  });

  it("every rule pauses only OUR ad sets — by the naming taxonomy — on a schedule, over one time window", () => {
    for (const code of ["META", "SIM"] as const) {
      for (const r of rulesSpec(ALL, code)) {
        const f = r.evaluation_spec.filters;
        expect(f).toContainEqual({ field: "entity_type", value: "ADSET", operator: "EQUAL" });
        expect(f).toContainEqual({ field: "name", value: `S360|${code}|adset|`, operator: "CONTAIN" });
        expect(f.filter((x) => x.field === "time_preset")).toHaveLength(1);
        expect(r).toMatchObject({ name: adRuleName(r.key, code), execution_spec: { execution_type: "PAUSE" }, schedule_spec: { schedule_type: "SEMI_HOURLY" } });
      }
    }
  });

  it("'pause when filled' is never a Meta rule: it depends on our opening, so the monitor owns it", () => {
    const only = rulesSpec({ ...ADS_SETTINGS_UNSET.auto_pause, pause_at_daily_cap: false, pause_when_filled: true }, "META");
    expect(only).toEqual([]);
  });
});
