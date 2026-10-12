import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref, type Ref } from "vue";
import type { AssignmentHistoryFilters } from "./useAssignments";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the Assignment history tab keeps its filters in the URL.
 *
 * What only this list has: it shares `/assignments` with the dispatch board, so every key is scoped
 * `history.` and the board's own `?search=` is never read as a history filter; and it OPENS on the
 * last seven days, a default that stays out of the URL and that Clear filters returns to.
 */

const DRIVER = "11111111-1111-4111-8111-111111111111";
const TRUCK = "22222222-2222-4222-8222-222222222222";
const asked = vi.hoisted(() => ({ filters: null as null | { value: unknown } }));

vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: DRIVER, full_name: "Pete Ross" }]) }) }));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: TRUCK, unit_number: "773" }]) }) }));
vi.mock("@/composables/useTrailers", () => ({ useTrailersQuery: () => ({ data: ref([]) }) }));
vi.mock("@/features/dispatch/useAssignments", () => ({
  useAssignmentHistoryQuery: (filters: Ref<AssignmentHistoryFilters>) => {
    asked.filters = filters;
    return {
      data: ref({ pages: [] }), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
      hasNextPage: ref(false), isFetchingNextPage: ref(false), refetch: vi.fn(), fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import AssignmentHistory from "./AssignmentHistory.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";

const filters = () => (asked.filters as Ref<AssignmentHistoryFilters>).value;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/assignments", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(AssignmentHistory, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const driver = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Driver")!;

describe("Assignment history keeps its filters in the URL", () => {
  it("opens on the last seven days with nothing in the URL", async () => {
    const { query } = await mountAt("/assignments?queue=history");
    expect(filters().from).toBe(iso(new Date(Date.now() - 7 * 86_400_000)));
    expect(filters().to).toBe(iso(new Date()));
    expect(query()).toEqual({ queue: "history" });
  });

  it("reads a pasted link's window and driver, and ignores the board's own search", async () => {
    const { w } = await mountAt(`/assignments?queue=history&search=773&history.from=2026-09-01&history.to=2026-09-03&history.driver=${DRIVER}`);
    expect(filters()).toEqual({ from: "2026-09-01", to: "2026-09-03", driverId: DRIVER });
    expect(driver(w).props("modelValue")).toBe(DRIVER);
    expect(w.findComponent(DateRangeFilter).props("from")).toBe("2026-09-01");
  });

  it("reads a date that is not a real day as the opening week", async () => {
    await mountAt("/assignments?history.from=2026-02-31");
    expect(filters().from).toBe(iso(new Date(Date.now() - 7 * 86_400_000)));
  });

  it("writes a control change under its own scope, and Clear filters leaves the board's keys alone", async () => {
    const { w, query } = await mountAt("/assignments?queue=history&sort=unit&dir=desc");
    driver(w).vm.$emit("update:modelValue", DRIVER);
    w.findComponent(DateRangeFilter).vm.$emit("update:from", "2026-09-01");
    w.findComponent(DateRangeFilter).vm.$emit("update:to", "2026-09-05");
    await flushPromises();
    expect(query()).toEqual({
      queue: "history", sort: "unit", dir: "desc",
      "history.driver": DRIVER, "history.from": "2026-09-01", "history.to": "2026-09-05",
    });

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ queue: "history", sort: "unit", dir: "desc" });
  });
});
