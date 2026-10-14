import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";

/**
 * F27 (US6b batch 3) — the week reads in the product's date. The browser pass found the report's
 * line and its Week choice printing `2026-10-12 → 2026-10-18`, the raw ISO the reads hand over.
 */
vi.mock("@/features/drivers/useDriverPerformance", () => ({
  useDriverPerformance: () => ({
    data: ref({ weekStart: "2026-10-12", weekEnd: "2026-10-18", rows: [], methodUsed: "percentile", trailingWeeks: 4 }),
    isLoading: ref(false),
    isError: ref(false),
    isFetching: ref(false),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/features/drivers/useDriverPerformanceWeeks", () => ({
  useDriverPerformanceWeeksList: () => ({ data: ref([{ weekStart: "2026-10-05", weekEnd: "2026-10-11" }]) }),
  useDriverPerformanceWeek: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false), refetch: vi.fn() }),
}));

import DriverPerformancePage from "./DriverPerformancePage.vue";

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/driver-performance", component: { template: "<div/>" }, meta: { title: "Driver Performance" } }],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(DriverPerformancePage, {
    global: { plugins: [router, createPinia()], stubs: { SamsaraFeedLine: true, RouterLink: true } },
  });
  await flushPromises();
  return w;
}

describe("DriverPerformancePage — the week in the product's date (F27)", () => {
  it("says the live week as MM/DD/YYYY, never the ISO it was handed", async () => {
    const t = (await mountAt("/driver-performance")).text();
    expect(t).toContain("10/12/2026 → 10/18/2026 · live");
    expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("says a settled week the same way, in the line and in the Week choice", async () => {
    const w = await mountAt("/driver-performance?week=2026-10-05");
    expect(w.text()).toContain("10/05/2026 → 10/11/2026 · final");
    expect(w.html()).toContain("10/05/2026 → 10/11/2026");
    expect(w.text()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
