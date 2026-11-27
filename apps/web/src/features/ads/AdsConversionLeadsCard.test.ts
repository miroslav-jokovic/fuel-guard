import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { ConversionLeadsView } from "@silvicom/shared";

/** V7e's card: each requirement beside what was measured, met / not yet / not known, and no switch anywhere. */
const state = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("./useAdsConversionLeads", () => ({
  useAdsConversionLeads: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(null), refetch: () => {} }),
}));
import AdsConversionLeadsCard from "./AdsConversionLeadsCard.vue";

const VIEW: ConversionLeadsView = {
  checked_at: "2026-11-20T15:00:00Z", offered: false, stage_rates: [],
  checks: [
    { key: "volume", met: false, measured: "12 Meta leads in the last 30 days", needs: "At least 200 leads a month" },
    { key: "feed", met: true, measured: "The outcome feed is on and names a Meta dataset", needs: "Each lead and its stages sent to Meta at least once a day" },
    { key: "employment", met: null, measured: "Not answered (Q-AD17)", needs: "Meta accepts the goal for a job ad" },
  ],
};

describe("AdsConversionLeadsCard", () => {
  it("says each requirement, what we measured and where it stands; offers no switch", () => {
    state.data = VIEW;
    const w = mount(AdsConversionLeadsCard);
    expect(w.find('[data-test="check-volume"]').text()).toContain("12 Meta leads");
    expect(w.find('[data-test="check-volume"]').text()).toContain("Not yet");
    expect(w.find('[data-test="check-feed"]').text()).toContain("Met");
    expect(w.find('[data-test="check-employment"]').text()).toContain("Not known");
    expect(w.findAll("button, input, [role='switch']").filter((e) => !e.text().includes("Retry"))).toHaveLength(0);
  });
});
