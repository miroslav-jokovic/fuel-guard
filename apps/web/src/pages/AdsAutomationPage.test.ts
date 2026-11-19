import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { AdsHealthView } from "@silvicom/shared";

/** Ads › Automation draws the health read as given; a failed read says so instead of drawing an idle machine. */
const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown }));
vi.mock("@/features/ads/useAdsOverview", () => ({
  useAdsHealth: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(state.error), refetch: () => {} }),
}));
import AdsAutomationPage from "./AdsAutomationPage.vue";

const VIEW: AdsHealthView = {
  checked_at: "2026-11-18T15:00:00Z", month: "2026-11",
  connections: [{
    id: "c1", provider: "meta", is_sandbox: true, status: "connected", last_test_at: "2026-11-18T14:00:00Z", last_error: null,
    token: { expiry: null, days_left: 5, tone: "warn", words: "Expires on 11/23/2026, in 5 days." },
  }],
  lead_webhook: { last_at: null },
  jobs: [{ kind: "ads_insights", label: "Ads insights", done: 3, failed: 1, running: 0, last_done_at: null, last_failed_at: "2026-11-18T10:01:00Z", last_error: "insights: rate limited", tone: "bad" }],
  agents: [{ agent: "strategist", enabled: true, calls: 4, in_shape: 3, failed: 1, budget_refused: 0, in_shape_share: 0.75, failures: [{ code: "bad_shape", count: 1 }], cost_units: 9_000, cost_unit: "tokens" }],
};

const render = () => mount(AdsAutomationPage, { global: { stubs: { PageHeader: true, AdsTabs: true } } });

beforeEach(() => {
  state.data = VIEW;
  state.error = null;
});

describe("AdsAutomationPage", () => {
  it("draws the connections, the lead webhook, the week's jobs and the month's agents", () => {
    const text = render().text();
    for (const s of [
      "Meta (Facebook, Instagram) · sandbox", "Expires on 11/23/2026, in 5 days.", "Meta has not told us of a lead yet.",
      "Ads insights", "insights: rate limited", "Plans the campaign", "75% (3 of 4)", "bad_shape × 1", "9,000 tokens",
    ]) expect(text, s).toContain(s);
  });

  it("a failed read is a failure on screen", () => {
    state.data = undefined;
    state.error = new Error("down");
    expect(render().text()).toContain("Could not load the ads health.");
  });
});
