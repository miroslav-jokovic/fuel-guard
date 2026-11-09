import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import AdsLeadQualitySection from "./AdsLeadQualitySection.vue";
import { toFormValues, toSettings } from "./adsSettingsForm";

/**
 * Settings › Ads control's lead-quality alert (LQ3b, Q-AD51 (a)). The save replaces the WHOLE settings object,
 * so the outcome feed's two traps are pinned for this group too: another section's save keeps it as it was, and
 * an older version without the group stays without it while the form shows exactly the ruled defaults.
 */
const SAVED: AdsSettings = { ...ADS_SETTINGS_UNSET, lead_quality: { enabled: false, min_attempted: 20, wrong_number_pct: 30, not_qualified_pct: 50 } };

describe("the lead-quality alert in the settings form", () => {
  it("a version from before the group reads as the ruled defaults, on, and an unrelated save leaves it without the group", () => {
    const v = toFormValues(ADS_SETTINGS_UNSET);
    expect([v.lead_quality_enabled, v.lead_quality_min_attempted, v.lead_quality_wrong_number_pct, v.lead_quality_not_qualified_pct]).toEqual([true, "10", "40", "40"]);
    const out = toSettings(ADS_SETTINGS_UNSET, { ...v, uncontacted_lead_minutes: "30" });
    expect(out.ok && "lead_quality" in out.settings).toBe(false);
  });

  it("saving another section keeps a saved group exactly as it was", () => {
    const out = toSettings(SAVED, { ...toFormValues(SAVED), uncontacted_lead_minutes: "30" });
    expect(out.ok && out.settings.lead_quality).toEqual(SAVED.lead_quality);
  });

  it("a saved group that happens to equal the defaults is kept, so the version reads back as itself", () => {
    const same: AdsSettings = { ...ADS_SETTINGS_UNSET, lead_quality: { enabled: true, min_attempted: 10, wrong_number_pct: 40, not_qualified_pct: 40 } };
    const out = toSettings(same, { ...toFormValues(same), uncontacted_lead_minutes: "30" });
    expect(out.ok && out.settings.lead_quality).toEqual(same.lead_quality);
  });

  it("changing any of its values writes the whole group, even on a version that had none", () => {
    const out = toSettings(ADS_SETTINGS_UNSET, { ...toFormValues(ADS_SETTINGS_UNSET), lead_quality_wrong_number_pct: "35" });
    expect(out.ok && out.settings.lead_quality).toEqual({ enabled: true, min_attempted: 10, wrong_number_pct: 35, not_qualified_pct: 40 });
    const off = toSettings(ADS_SETTINGS_UNSET, { ...toFormValues(ADS_SETTINGS_UNSET), lead_quality_enabled: false });
    expect(off.ok && off.settings.lead_quality?.enabled).toBe(false);
  });

  it("a share past 100 or a blank count is refused in words on its own field", () => {
    expect(toSettings(SAVED, { ...toFormValues(SAVED), lead_quality_not_qualified_pct: "120" }))
      .toEqual({ ok: false, field: "lead_quality.not_qualified_pct", message: "The not-qualified share must be a whole percent from 1 to 100." });
    expect(toSettings(SAVED, { ...toFormValues(SAVED), lead_quality_min_attempted: "" }))
      .toMatchObject({ ok: false, field: "lead_quality.min_attempted" });
  });
});

describe("AdsLeadQualitySection", () => {
  const mountIt = (editable: boolean) => mount(AdsLeadQualitySection, {
    props: { editable, errorOn: () => undefined, enabled: true, minAttempted: "10", wrongPct: "40", notQualifiedPct: "40" },
  });

  it("says it is an alert and never a pause, and that the starting values are a rule of thumb", () => {
    const w = mountIt(true);
    expect(w.text()).toContain("An alert, never a pause");
    expect(w.find('[data-test="lead-quality-help"]').text()).toContain("industry rule of thumb");
    expect(w.find('[data-test="lead-quality-help"]').text()).toContain("never counted against them");
  });

  it("a person who cannot edit sees the values, disabled", () => {
    const w = mountIt(false);
    const input = w.find('[data-test="lead-quality-wrong"]');
    const el = (input.element.tagName === "INPUT" ? input : input.find("input")).element as HTMLInputElement;
    expect([el.disabled, el.value]).toEqual([true, "40"]);
  });
});
