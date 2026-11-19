import { describe, expect, it } from "vitest";
import { withinBudget } from "../ai.js";
import { adsTokensLeft, aiGate, renderGate, ticksAsDollars, usdTicks } from "./aiRail.js";
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

describe("renderGate — Higgsfield renders in US dollars (C3; Q-APX16)", () => {
  // A budget of $1.00 is 100 cents, 10,000 ticks.
  const s = (cents: number | null, on = true) => ({ ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_usd_cents_monthly: cents, agents_enabled: { renderer: on } } });
  it("refuses a switched-off renderer, an unread price and an unset budget, in that order of reasons", () => {
    expect(renderGate(s(100, false), "renderer", 0, 940)).toEqual({ open: false, refusal: "agent_off" });
    expect(renderGate(s(100), "renderer", 0, null)).toEqual({ open: false, refusal: "price_unknown" });
    expect(renderGate(s(null), "renderer", 0, 940)).toEqual({ open: false, refusal: "budget_unset" });
  });
  it("opens only when the price fits what is left: used + price ≤ budget, to the hundredth of a cent", () => {
    expect(renderGate(s(100), "renderer", 9_060, 940)).toEqual({ open: true });
    expect(renderGate(s(100), "renderer", 9_061, 940)).toEqual({ open: false, refusal: "budget_spent" });
  });
  it("the retired credits budget opens nothing", () => {
    const old = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_credits_monthly: 1_000_000, agents_enabled: { renderer: true } } };
    expect(renderGate(old, "renderer", 0, 1)).toEqual({ open: false, refusal: "budget_unset" });
  });
});

describe("usdTicks — the estimate's dollar string, read exactly", () => {
  it("reads the documented answer and whole dollars", () => {
    expect(usdTicks("0.094")).toBe(940);
    expect(usdTicks("1")).toBe(10_000);
    expect(usdTicks("12.3456")).toBe(123_456);
  });
  it("rounds a price finer than a hundredth of a cent UP, so a month never understates", () => {
    expect(usdTicks("0.00001")).toBe(1);
    expect(usdTicks("0.12340")).toBe(1_234);
  });
  it("refuses anything that is not a plain amount", () => {
    for (const bad of ["", "-0.1", "1e-3", "$0.10", "0,10", "abc", ".5"]) expect(usdTicks(bad), bad).toBeNull();
  });
  it("writes ticks back as dollars to four places", () => {
    expect(ticksAsDollars(940)).toBe("0.0940");
    expect(ticksAsDollars(123_456)).toBe("12.3456");
  });
});

describe("a settings version saved before Q-APX16", () => {
  it("parses, with no dollar budget (nobody chose one), and a version saved now still carries the retired key", () => {
    const { higgsfield_usd_cents_monthly: _usd, ...before } = ADS_SETTINGS_UNSET.budgets;
    const parsed = adsSettingsSchema.parse({ ...ADS_SETTINGS_UNSET, budgets: before });
    expect(parsed.budgets.higgsfield_usd_cents_monthly).toBeNull();
    const { higgsfield_credits_monthly: _c, ...now } = ADS_SETTINGS_UNSET.budgets;
    expect("higgsfield_credits_monthly" in adsSettingsSchema.parse({ ...ADS_SETTINGS_UNSET, budgets: now }).budgets).toBe(true);
  });
});
