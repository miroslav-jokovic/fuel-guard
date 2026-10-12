import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import FleetTrucksTab from "./FleetTrucksTab.vue";
import FleetContractorsTab from "./FleetContractorsTab.vue";
import CpmTruckTable from "./CpmTruckTable.vue";
import CpmOwnerOperatorTable from "./CpmOwnerOperatorTable.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import type { FleetTruck, OwnerOperatorRow } from "./useFleetReport";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the per-truck and contractor tabs of the fleet report keep
 * their list in the URL, each under its own scope (`trucks.`, `contractors.`), because every tab of
 * the report shares one route: page 4 of the trucks must not be page 4 of anything else (owner
 * ruling 2026-08-29) — the scope keeps the tabs apart, and each tab clears its own scope when it is
 * left for another tab, which is what the remount used to do.
 */
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

const truck = (i: number, over: Partial<FleetTruck> = {}): FleetTruck => ({
  tractor_unit: `${100 + i}`, loads: i, miles: i * 200, revenue: i * 1000, revenuePerMile: 5, isOwnerOperator: false, ...over,
});
const TRUCKS: FleetTruck[] = [
  ...Array.from({ length: 24 }, (_, i) => truck(i + 1)),
  truck(90, { isOwnerOperator: true, miles: 9000 }),
];
const contractor = (i: number): OwnerOperatorRow => ({
  payeeId: `p${i}`, units: [`${i}`], settlements: 1, revenue: 100, pay: 80, grossMargin: 20, deductionIncome: 0, netMargin: 20, dealPct: 0.8,
});

async function mountAt<C>(component: C, props: Record<string, unknown>, url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/accounting/fleet", component: { template: "<div/>" } }] });
  await router.push(url);
  await router.isReady();
  // Two components share this helper, so the mount is typed loosely; each assertion names its table.
  const w = mount(component as never, { props, global: { plugins: [router] } } as never);
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
const trucksAt = (url: string) =>
  mountAt(FleetTrucksTab, { trucks: TRUCKS, loading: false, error: null, from: "2026-07-01", to: "2026-07-31" }, url);

describe("the per-truck tab keeps its list in the URL", () => {
  it("opens on Any mileage, company trucks only, with nothing in the URL", async () => {
    const { w, query } = await trucksAt("/accounting/fleet");
    expect(w.findComponent(FilterSelect).props("modelValue")).toBe("0");
    expect(w.findComponent(CpmTruckTable).props("total")).toBe(24);
    expect(query()).toEqual({});
  });

  it("reads the floor, the contractor switch, the sort and the page back from a pasted link", async () => {
    const { w } = await trucksAt("/accounting/fleet?trucks.minMiles=1000&trucks.contractors=1&trucks.sort=miles&trucks.dir=desc&trucks.page=2");
    const table = w.findComponent(CpmTruckTable);
    // 1,000+ miles: trucks 5..24 (20) plus the contractor's truck, now included.
    expect(table.props("total")).toBe(21);
    expect(table.props("sort")).toEqual({ key: "miles", dir: "desc" });
    expect(table.props("page")).toBe(2);
    expect((table.props("rows") as FleetTruck[]).map((t) => t.tractor_unit)).toEqual(["105"]);
  });

  it("writes a control change to the URL and returns to page 1", async () => {
    const { w, query } = await trucksAt("/accounting/fleet?trucks.page=2");
    w.findComponent(FilterSelect).vm.$emit("update:modelValue", "5000");
    await flushPromises();
    expect(query()).toEqual({ "trucks.minMiles": "5000" });
  });

  it("Clear filters keeps the sort and the contractor switch", async () => {
    const { w, query } = await trucksAt("/accounting/fleet?trucks.search=10&trucks.minMiles=100&trucks.contractors=1&trucks.sort=revenue&trucks.dir=asc");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ "trucks.contractors": "1", "trucks.sort": "revenue", "trucks.dir": "asc" });
  });

  it("reads a floor nobody offered, and a column it does not have, as the defaults", async () => {
    const { w } = await trucksAt("/accounting/fleet?trucks.minMiles=37&trucks.sort=netMargin");
    expect(w.findComponent(FilterSelect).props("modelValue")).toBe("0");
    expect(w.findComponent(CpmTruckTable).props("sort")).toEqual({ key: null, dir: "asc" });
  });
});

describe("the contractor tab keeps its page in the URL", () => {
  const contractorsAt = (url: string) =>
    mountAt(FleetContractorsTab, { ownerOperators: Array.from({ length: 25 }, (_, i) => contractor(i)), report: null, loading: false, error: null, from: "2026-07-01", to: "2026-07-31" }, url);

  it("reads its own page, never another tab's", async () => {
    const { w } = await contractorsAt("/accounting/fleet?contractors.page=2&trucks.page=3");
    expect(w.findComponent(CpmOwnerOperatorTable).props("page")).toBe(2);
  });

  it("writes a page change under its scope", async () => {
    const { w, query } = await contractorsAt("/accounting/fleet");
    w.findComponent(CpmOwnerOperatorTable).vm.$emit("update:page", 2);
    await flushPromises();
    expect(query()).toEqual({ "contractors.page": "2" });
  });
});
