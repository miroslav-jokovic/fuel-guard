import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Fuel planning's History tab keeps its filters in the URL,
 * under `history.`, because it shares `/fuel-planning` with the Plan tab.
 */

const plan = (id: string, unit: string, status: string, created_at: string) => ({
  id, unit_number: unit, status, created_at, origin_label: "Dallas, TX", destination_label: "Tulsa, OK",
  created_by_label: "Pete", distance_miles: 260, stop_count: 1, total_gallons: 80, total_cost: 300,
});
const rows = [
  plan("p1", "701", "ok", "2026-09-02T12:00:00Z"),
  plan("p2", "754", "infeasible", "2026-09-10T12:00:00Z"),
  plan("p3", "701", "infeasible", "2026-09-20T12:00:00Z"),
  plan("p4", "754", "infeasible", "2026-09-25T12:00:00Z"),
];
vi.mock("./useFuelPlan", () => ({
  useFuelPlanHistory: () => ({ data: ref(rows), isLoading: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useDeleteFuelPlan: () => ({ mutateAsync: vi.fn() }),
  useDeleteFuelPlans: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import PlanHistory from "./PlanHistory.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-planning", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(PlanHistory, { global: { plugins: [router, createPinia()], stubs: { KebabMenu: true } } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const select = (w: Mounted, label: string) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
const count = (w: Mounted) => w.findComponent({ name: "FilterBar" }).props("count");

describe("Plan history keeps its filters in the URL", () => {
  it("reads a pasted link's status, truck and window", async () => {
    const { w } = await mountAt("/fuel-planning?history.status=infeasible&history.truck=701&history.from=2026-09-15");
    expect(select(w, "Status").props("modelValue")).toBe("infeasible");
    expect(count(w)).toBe(1);
  });

  it("reads a status the list does not name as no filter", async () => {
    const { w } = await mountAt("/fuel-planning?history.status=sold");
    expect(select(w, "Status").props("modelValue")).toBe("");
    expect(count(w)).toBe(4);
  });

  it("writes a control change under its scope, and Clear filters empties only that scope", async () => {
    const { w, query } = await mountAt("/fuel-planning?search=dallas");
    select(w, "Truck").vm.$emit("update:modelValue", "754");
    await flushPromises();
    expect(query()).toEqual({ search: "dallas", "history.truck": "754" });
    expect(count(w)).toBe(2);

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ search: "dallas" });
    expect(count(w)).toBe(4);
  });
});
