import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import type { PerformanceDisplayRow } from "@/features/drivers/useDriverPerformance";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Driver performance keeps its week, its list's filters, its
 * sort and its page in the URL. The week is the REPORT's scope, not a filter: Clear filters leaves it
 * (and the sort) where it is.
 */
const drv = (i: number, eligible: boolean): PerformanceDisplayRow => ({
  driverId: `d${i}`, driverName: `Driver ${String(i).padStart(2, "0")}`, rank: eligible ? i : null, trailingFinal: 50 + i,
  weekFinal: 50 + i, isWinner: false, safetyScore: 80, efficiencyScore: 70, idleScore: 60, safetyPct: null,
  efficiencyPct: null, idlePct: null, miles: 1000, driveHours: 40, eligible, ineligibleReason: eligible ? null : "below_min_miles",
});
const liveRows = Array.from({ length: 24 }, (_, i) => drv(i + 1, i < 20));
const asked = vi.hoisted(() => ({ week: null as string | null }));
vi.mock("@/features/drivers/useDriverPerformance", () => ({
  useDriverPerformance: () => ({
    data: ref({ weekStart: "2026-10-05", weekEnd: "2026-10-11", methodUsed: "percentile", rows: liveRows, weights: { safety: 0.5, efficiency: 0.25, idling: 0.25 }, trailingWeeks: 3 }),
    isLoading: ref(false), isError: ref(false),
  }),
}));
vi.mock("@/features/drivers/useDriverPerformanceWeeks", () => ({
  useDriverPerformanceWeeksList: () => ({ data: ref([{ weekStart: "2026-09-28", weekEnd: "2026-10-04" }]) }),
  useDriverPerformanceWeek: (week: Ref<string | null>) => ({
    data: computed(() => {
      asked.week = week.value;
      return week.value
        ? [{ driver_id: "f1", driver_name: "Frozen Driver", rank: 1, trailing_final: 90, week_final: 90, is_winner: false, eligible: true, ineligible_reason: null, method_used: "raw" }]
        : undefined;
    }),
    isLoading: ref(false), isError: ref(false),
  }),
}));
vi.mock("@/components/SamsaraFeedLine.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import DriverPerformancePage from "./DriverPerformancePage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/driver-performance", component: { template: "<div/>" }, meta: { title: "Driver performance" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(DriverPerformancePage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const select = (w: Mounted, label: string) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
const names = (w: Mounted) => w.findAll("tbody tr td:nth-child(2)").map((td) => td.text());

describe("Driver performance keeps its report and list in the URL", () => {
  it("reads the status, search, sort and page back from a pasted link", async () => {
    const { w } = await mountAt("/driver-performance?status=ineligible&sort=driverName&dir=desc");
    expect(select(w, "Status").props("modelValue")).toBe("ineligible");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "driverName", dir: "desc" });
    expect(names(w)).toEqual(["Driver 24", "Driver 23", "Driver 22", "Driver 21"]);

    const paged = await mountAt("/driver-performance?page=2");
    expect(paged.w.findComponent(TablePagination).props("page")).toBe(2);
    expect(names(paged.w)).toHaveLength(4);
  });

  it("opens a frozen week named in the link, and reads a week that is not a date as the live one", async () => {
    const { w } = await mountAt("/driver-performance?week=2026-09-28");
    expect(select(w, "Week").props("modelValue")).toBe("2026-09-28");
    expect(asked.week).toBe("2026-09-28");
    expect(names(w)).toEqual(["Frozen Driver"]);

    const bogus = await mountAt("/driver-performance?week=last");
    expect(select(bogus.w, "Week").props("modelValue")).toBe("");
    expect(names(bogus.w)).toHaveLength(20);
  });

  it("writes a chosen status and returns to page 1; Clear filters keeps the week and the sort", async () => {
    const { w, query } = await mountAt("/driver-performance?week=2026-09-28&page=2&sort=final&dir=desc&search=x");
    select(w, "Status").vm.$emit("update:modelValue", "eligible");
    await flushPromises();
    expect(query()).toEqual({ week: "2026-09-28", sort: "final", dir: "desc", search: "x", status: "eligible" });

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ week: "2026-09-28", sort: "final", dir: "desc" });
  });
});
