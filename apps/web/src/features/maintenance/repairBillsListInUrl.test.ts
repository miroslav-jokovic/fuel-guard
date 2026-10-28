import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";
import { lastFullMonth } from "@/lib/dateWindow";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Repair spend keeps its window and page in the URL. The
 * last full month is where the page opens; it stays out of the URL so a bookmark keeps meaning
 * "the month that last closed", and Clear filters returns to it.
 */

const asked = vi.hoisted(() => ({ filter: null as null | { value: { from: string; to: string; page: number } } }));
vi.mock("@/features/maintenance/useMaintenanceSpend", () => ({
  useMaintenanceSpendQuery: (filter: { value: { from: string; to: string; page: number } }) => {
    asked.filter = filter;
    return {
      data: ref({ entries: [{ id: "e1", occurred_at: "2026-09-02T12:00:00Z", amount: 120, external_id: "WO-1", source: "mcleod" }], total: 120, pendingSources: null }),
      isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
    };
  },
}));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => false }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import MaintenanceSpendPage from "./ShopRepairBillsPanel.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { TablePagination } from "@silvicom/ui";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/maintenance/spend", component: { template: "<div/>" }, meta: { title: "Repair spend" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(MaintenanceSpendPage, { global: { plugins: [router, createPinia()], stubs: { PageHeader: true } } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}

describe("Repair spend keeps its window and page in the URL", () => {
  it("opens on the last full month with nothing in the URL", async () => {
    const { query } = await mountAt("/maintenance/spend");
    expect(asked.filter!.value).toEqual({ ...lastFullMonth(), page: 1 });
    expect(query()).toEqual({});
  });

  it("reads a pasted link's window and page", async () => {
    const { w } = await mountAt("/maintenance/spend?from=2026-06-01&to=2026-06-30&page=2");
    expect(asked.filter!.value).toEqual({ from: "2026-06-01", to: "2026-06-30", page: 2 });
    expect(w.findComponent(TablePagination).props("page")).toBe(2);
  });

  it("reads a date that is not a real day as the default end", async () => {
    await mountAt("/maintenance/spend?to=2026-06-31");
    expect(asked.filter!.value.to).toBe(lastFullMonth().to);
  });

  it("writes a window change and returns to page 1; Clear filters empties the URL", async () => {
    const { w, query } = await mountAt("/maintenance/spend?page=3");
    w.findComponent(DateRangeFilter).vm.$emit("update:from", "2026-06-01");
    w.findComponent(DateRangeFilter).vm.$emit("update:to", "2026-06-30");
    await flushPromises();
    expect(query()).toEqual({ from: "2026-06-01", to: "2026-06-30" });

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({});
    expect(asked.filter!.value).toEqual({ ...lastFullMonth(), page: 1 });
  });
});
