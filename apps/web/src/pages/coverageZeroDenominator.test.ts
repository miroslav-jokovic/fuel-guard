import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";
import { computeCapacityHealth, computeDetectionCoverage } from "@silvicom/shared";

/**
 * F14 (US6b) — a share of nothing is not a share. The aggregators answer 0 for every percentage over
 * no fills, and 100 for the capacity of a roster with no fuel trucks, so the strip drew red "0%" tiles
 * and a green "100%" for a fleet with nothing to judge. The fixtures are the REAL aggregators' answers
 * for an empty window, so a change in what they return for nothing still reaches this test.
 */
vi.mock("@/features/fuel/useDetectionCoverage", () => ({
  useDetectionCoverage: () => ({
    data: ref(computeDetectionCoverage([])),
    isLoading: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
    isFetching: ref(false),
  }),
  useCapacityHealth: () => ({ data: ref(computeCapacityHealth([])) }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));

import CoveragePage from "./CoveragePage.vue";
import { StatCard } from "@silvicom/ui";

describe("Detection coverage with nothing to measure (F14)", () => {
  it("draws every tile as a dash with its reason, and no tile as a verdict", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/coverage", component: { template: "<div/>" } }] });
    await router.push("/coverage");
    await router.isReady();
    const w = mount(CoveragePage, { global: { plugins: [router, createPinia()] } });
    await flushPromises();
    const tiles = w.findAllComponents(StatCard);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.props("value"), t.props("label")).toBe("—");
      expect(t.props("valueTone"), t.props("label")).toBeUndefined();
    }
    expect(w.text()).toContain("No fills in the last 90 days to check");
    expect(w.text()).toContain("No active fuel trucks on the roster");
  });
});
