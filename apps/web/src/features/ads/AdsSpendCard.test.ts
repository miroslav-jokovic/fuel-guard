import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { AdsSpendView } from "@silvicom/shared";

/** The spend card (E1c) draws the API's figures as given, and draws a failed read as a failure, not as $0. */
const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown }));
vi.mock("./useAdsSettings", () => ({
  useAdsSpend: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(state.error), refetch: () => {} }),
}));
import AdsSpendCard from "./AdsSpendCard.vue";

const VIEW: AdsSpendView = {
  month: "2026-11", today: "2026-11-15", days_left: 16,
  platforms: [{ platform: "meta", month_to_date_cents: 8_000, cap_cents: 300_000, live_daily_cents: 5_000, forecast_cents: 88_000 }],
  campaigns: [{
    id: "c1", name: "CDL-A Dallas", state: "live", platform: "meta", daily_budget_cents: 5_000, lifetime_cap_cents: 150_000,
    today_spend_cents: 1_500, lifetime_spend_cents: 14_500, lifetime_leads: 4, lifetime_cost_per_lead_cents: 3_625,
  }],
  ai: { tokens_used: 15_000, tokens_budget: 1_000_000, credits_used: 40, credits_budget: null },
  reconcile: [{ connection_id: "m", provider: "meta", last_run_at: null, late: true, changes_since: 0 }],
};

beforeEach(() => {
  state.data = undefined;
  state.error = null;
});

describe("AdsSpendCard", () => {
  it("draws each figure the API gave, beside what it is measured against", () => {
    state.data = VIEW;
    const text = mount(AdsSpendCard).text();
    for (const s of [
      "$80 of $3,000 spent this month", "On course for $880", "CDL-A Dallas", "Live",
      "$15 of $50", "$145 of $1,500", "$36.25", "15,000 of 1,000,000 AI tokens used this month.",
      "No monthly budget is saved, so the agents cannot use any.", "Never checked against Meta yet.",
    ]) expect(text, s).toContain(s);
  });

  it("with nothing connected it says so, rather than drawing a $0 platform", () => {
    state.data = { ...VIEW, platforms: [], campaigns: [], reconcile: [] };
    const text = mount(AdsSpendCard).text();
    expect(text).toContain("No ad account is connected, so nothing has spent.");
    expect(text).not.toContain("No campaign has reached a platform yet.");
  });

  it("a failed read is a failure on screen, never a spend of nothing", () => {
    state.error = new Error("down");
    const text = mount(AdsSpendCard).text();
    expect(text).toContain("Could not load the spend so far.");
    expect(text).not.toContain("$0");
  });
});
