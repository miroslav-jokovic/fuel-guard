import { describe, expect, it } from "vitest";
import { withinBudget } from "../ai.js";
import { adsTokensLeft, aiGate } from "./aiRail.js";
import { AD_AI_AGENTS } from "./contracts.js";
import { ADS_SETTINGS_UNSET, adsSettingsSchema, type AdsSettings } from "./settingsContract.js";

const settings = (budgets: Partial<AdsSettings["budgets"]>): AdsSettings => ({
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, ...budgets },
});
const on = { copywriter: true } as const;

describe("aiGate — the per-agent switch (D-RA9)", () => {
  it("every agent is off in a carrier that never saved settings", () => {
    for (const agent of AD_AI_AGENTS) {
      expect(aiGate(settings({ anthropic_tokens_monthly: 1_000_000 }), agent, 0)).toEqual({ open: false, refusal: "agent_off" });
    }
  });

  it("switching one agent on opens that agent only", () => {
    const s = settings({ anthropic_tokens_monthly: 1_000, agents_enabled: on });
    expect(aiGate(s, "copywriter", 0)).toEqual({ open: true, tokens_left: 1_000 });
    expect(aiGate(s, "checker", 0)).toEqual({ open: false, refusal: "agent_off" });
  });

  it("an agent switched off explicitly is refused before its budget is read", () => {
    const s = settings({ anthropic_tokens_monthly: null, agents_enabled: { copywriter: false } });
    expect(aiGate(s, "copywriter", 0)).toEqual({ open: false, refusal: "agent_off" });
  });
});

describe("aiGate — the monthly token budget (D-AD13)", () => {
  it("a null budget refuses, even with nothing used — the opposite of withinBudget's null", () => {
    expect(withinBudget(0, null)).toBe(true);
    expect(aiGate(settings({ anthropic_tokens_monthly: null, agents_enabled: on }), "copywriter", 0)).toEqual({
      open: false,
      refusal: "budget_unset",
    });
  });

  it("budget −1 is open, budget and budget +1 are spent", () => {
    const s = settings({ anthropic_tokens_monthly: 50_000, agents_enabled: on });
    expect(aiGate(s, "copywriter", 49_999)).toEqual({ open: true, tokens_left: 1 });
    expect(aiGate(s, "copywriter", 50_000)).toEqual({ open: false, refusal: "budget_spent" });
    expect(aiGate(s, "copywriter", 50_001)).toEqual({ open: false, refusal: "budget_spent" });
  });

  it("a budget of zero is a saved 'no Claude this month', not unset", () => {
    expect(aiGate(settings({ anthropic_tokens_monthly: 0, agents_enabled: on }), "copywriter", 0)).toEqual({
      open: false,
      refusal: "budget_spent",
    });
  });

  it("adsTokensLeft never goes negative after an overshoot", () => {
    expect(adsTokensLeft(60_000, 50_000)).toBe(0);
    expect(adsTokensLeft(0, null)).toBeNull();
  });
});

describe("settings contract — agents_enabled", () => {
  it("a version saved before the field existed parses with every agent off", () => {
    const { agents_enabled: _, ...older } = ADS_SETTINGS_UNSET.budgets;
    const parsed = adsSettingsSchema.parse({ ...ADS_SETTINGS_UNSET, budgets: older });
    expect(parsed.budgets.agents_enabled).toEqual({});
  });

  it("an agent the contract does not name is refused at save", () => {
    const bad = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, agents_enabled: { publisher: true } } };
    expect(adsSettingsSchema.safeParse(bad).success).toBe(false);
  });
});
