import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, type Pinia } from "pinia";
import { answerConfirm } from "@/testing/confirm";
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
const deletes = vi.hoisted(() => ({ one: vi.fn(async () => {}), many: vi.fn(async (ids: string[]) => ids.length) }));
vi.mock("./useFuelPlan", () => ({
  useFuelPlanHistory: () => ({ data: ref(rows), isLoading: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useDeleteFuelPlan: () => ({ mutateAsync: deletes.one }),
  useDeleteFuelPlans: () => ({ mutateAsync: deletes.many }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import PlanHistory from "./PlanHistory.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

async function mountAt(url: string, pinia: Pinia = createPinia()) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-planning", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  // The kebab renders its items in place, so a row's "Delete plan" can be clicked.
  const w = mount(PlanHistory, { global: { plugins: [router, pinia], stubs: { KebabMenu: { template: "<div><slot/></div>" } } } });
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

/** D-US8: twenty plans a page, the page in the URL under the tab's own `history.` scope. */
describe("Plan history pages", () => {
  const many = Array.from({ length: 45 }, (_, i) =>
    plan(`m${i + 1}`, String(1001 + i), "ok", `2026-09-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`));
  const units = (w: Mounted) => w.findAll("tbody tr").map((tr) => tr.findAll("td")[3]!.text());

  it("shows plans 21–40 on a pasted ?history.page=2, and a filter change goes back to page 1", async () => {
    const saved = rows.splice(0, rows.length, ...many);
    try {
      const { w, query } = await mountAt("/fuel-planning?history.page=2");
      expect(units(w)).toEqual(many.slice(20, 40).map((p) => p.unit_number));
      select(w, "Status").vm.$emit("update:modelValue", "ok");
      await flushPromises();
      expect(query()).toEqual({ "history.status": "ok" });
      expect(units(w)[0]).toBe("1001");
    } finally {
      rows.splice(0, rows.length, ...saved);
    }
  });
});

/** D-US7: deleting a plan asks the product's confirm, never the browser's. */
describe("Plan history asks before it deletes", () => {
  const deleteRow = async (w: Mounted) => {
    await w.findAll("button").find((b) => b.text() === "Delete plan")!.trigger("click");
    await flushPromises();
  };
  const bulkDelete = async (w: Mounted) => {
    w.findComponent({ name: "DataTable" }).vm.$emit("update:selected", new Set(["p1", "p2"]));
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Delete")!.trigger("click");
    await flushPromises();
  };

  it("deletes nothing when one plan's delete is declined, and names the route it asked about", async () => {
    deletes.one.mockClear();
    const pinia = createPinia();
    const spy = answerConfirm(false, pinia);
    const { w } = await mountAt("/fuel-planning", pinia);
    await deleteRow(w);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      title: "Delete this plan?", message: "Dallas, TX → Tulsa, OK", confirmLabel: "Delete", tone: "danger",
    }));
    expect(deletes.one).not.toHaveBeenCalled();
  });

  it("deletes the plan when the question is answered yes", async () => {
    deletes.one.mockClear();
    const pinia = createPinia();
    answerConfirm(true, pinia);
    const { w } = await mountAt("/fuel-planning", pinia);
    await deleteRow(w);
    expect(deletes.one).toHaveBeenCalledWith("p1");
  });

  it("asks once for a bulk delete, counting the plans, and deletes only on yes", async () => {
    deletes.many.mockClear();
    const pinia = createPinia();
    const no = answerConfirm(false, pinia);
    const { w } = await mountAt("/fuel-planning", pinia);
    await bulkDelete(w);
    expect(no).toHaveBeenCalledWith(expect.objectContaining({
      title: "Delete 2 plans?", message: "This can't be undone.", confirmLabel: "Delete", tone: "danger",
    }));
    expect(deletes.many).not.toHaveBeenCalled();

    no.mockImplementation(async () => true);
    await bulkDelete(w);
    expect(deletes.many).toHaveBeenCalledWith(["p1", "p2"]);
  });
});
