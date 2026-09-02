import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * FUEL-T5 / Q-FUI14 — the Cards page's half of "say what is measured".
 *
 * The ruling (2026-09-02) is that Cards carries rows-in-window and last-feed-poll and NOT the
 * attribution share: a card is issued to a driver or a truck as SETUP, not attributed per row, so
 * there is no denominator. The count was already in the filter bar. The poll time was already
 * computed — `freshness()` returns a plain "Checked 20 minutes ago." inside the sweep cadence — and
 * the page rendered it only when `stale`, so a correctly-working page said nothing at all about when
 * it had last read from EFS. This pins that it now always says, and that only the stale form keeps
 * the caution colour.
 */

const syncedAt = ref<string | null>(null);
const cards = () => [
  {
    id: "c1", maskedRef: "••1234", status: "active", driverName: "Ann Lee", unitPrompt: "101",
    driverIdPrompt: "7", policyNumber: 3, overrideUses: 0, fuelCardId: "f1", syncError: null,
    syncedAt: syncedAt.value, absentSince: null, capabilities: {}, limits: [],
  },
];

vi.mock("@/features/fuelCards/useEfsCards", () => ({
  useEfsCards: () => ({
    data: ref({ cards: cards(), staleAfterMinutes: 1440, truncated: false }),
    isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
    refetch: () => {},
  }),
}));
vi.mock("@/features/jobs/useJob", () => ({
  useJob: () => ({ latest: ref(null), lastDone: ref(null), isRunning: ref(false), refetch: () => {} }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import FuelCardsPage from "./FuelCardsPage.vue";

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const render = () => mount(FuelCardsPage, { shallow: false, global: { plugins: [VueQueryPlugin, createPinia()], stubs: { DataTable: true, ActiveOverridesPanel: true, UnitMileageDrawer: true, FilterBar: true, FilterSelect: true, PageHeader: true, TablePagination: true, KebabMenu: true } } });

beforeEach(() => { syncedAt.value = minutesAgo(20); });

describe("FuelCardsPage — when the card list was last read from EFS", () => {
  // The change. Before this, a page inside its sweep cadence said nothing at all.
  it("says when it last checked even when the sweep is on time", () => {
    expect(render().text()).toContain("Checked 20 minutes ago.");
  });

  it("keeps the caution colour for a sweep that has actually not run, and spends it nowhere else", () => {
    expect(render().html()).not.toContain("caution");

    // 1,440 minutes is the cadence this fixture reports; past it the sentence earns its next action.
    syncedAt.value = minutesAgo(3000);
    const stale = render();
    expect(stale.html()).toContain("text-caution-700");
    expect(stale.text()).toContain("Refresh to see current settings.");
  });
});
