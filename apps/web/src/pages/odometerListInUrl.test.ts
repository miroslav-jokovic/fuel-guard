import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";
import type { OdoMismatchRow } from "@silvicom/shared";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Odometer mismatches keep their filters, sort and page in the URL.
 *
 * The case this list pins that Trailers does not: it opens SORTED, newest first. That default is the
 * fallback of both sort parameters, so a plain link opens on it with nothing in the URL — and the
 * third click on Date, "no sort", still has to be a state of its own rather than snapping back.
 */
const row = (i: number, over: Partial<OdoMismatchRow> = {}): OdoMismatchRow => ({
  id: `f${i}`, fueledAt: `2026-09-${String(i).padStart(2, "0")}T12:00:00Z`, vehicleId: i % 2 ? "v1" : "v2",
  unit: i % 2 ? "101" : "202", driverId: null, driverName: `Driver ${i}`, entered: 1000 + i, samsara: 900,
  offset: 0, diff: 100 + i, absDiff: 100 + i, timeBasis: null, locationConfidence: null, samsaraOdometerAt: null,
  samsaraOdometerSource: null, ...over,
});
const rows = Array.from({ length: 24 }, (_, i) => row(i + 1));
vi.mock("@/features/roster/useOdometerMismatches", () => ({
  useOdometerMismatches: () => ({
    data: ref({ toleranceMiles: 10, rows, offenders: [] }),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "101" }, { id: "v2", unit_number: "202" }]) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@/components/SamsaraFeedLine.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import OdometerPage from "./OdometerPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/odometer", component: { template: "<div/>" }, meta: { title: "Odometer" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(OdometerPage, { global: { plugins: [router, createPinia()], stubs: { DateRangeFilter: true } } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const sortOf = (w: Mounted) => w.findComponent({ name: "DataTable" }).props("sort");
const total = (w: Mounted) => w.findComponent(TablePagination).props("total");

describe("Odometer mismatches keep their list in the URL", () => {
  it("opens newest first with nothing in the URL", async () => {
    const { w, query } = await mountAt("/odometer");
    expect(sortOf(w)).toEqual({ key: "fueledAt", dir: "desc" });
    expect(query()).toEqual({});
  });

  it("keeps the third click on Date as no sort, also after a reload", async () => {
    const { w, query } = await mountAt("/odometer");
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "fueledAt");
    await flushPromises();
    expect(sortOf(w)).toEqual({ key: null, dir: "asc" });
    expect(query()).toEqual({ sort: "any", dir: "any" });

    const reloaded = await mountAt("/odometer?sort=any&dir=any");
    expect(sortOf(reloaded.w)).toEqual({ key: null, dir: "asc" });
  });

  it("reads filters, sort and page back from a pasted link", async () => {
    const { w } = await mountAt("/odometer?vehicle=v2&from=2026-09-05&to=2026-09-20&sort=diff&dir=asc");
    expect(w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Vehicle")!.props("modelValue")).toBe("v2");
    // Even days 6..20 → 8 readings for v2.
    expect(total(w)).toBe(8);
    expect(sortOf(w)).toEqual({ key: "diff", dir: "asc" });

    const paged = await mountAt("/odometer?page=2");
    expect(paged.w.findComponent(TablePagination).props("page")).toBe(2);
    expect(paged.w.findAll("tbody tr")).toHaveLength(4);
  });

  it("reads a hand-edited date that is not a day as no date", async () => {
    const { w } = await mountAt("/odometer?from=yesterday");
    expect(total(w)).toBe(24);
  });

  it("writes a chosen vehicle and returns to page 1; Clear filters keeps the sort", async () => {
    const { w, query } = await mountAt("/odometer?page=2&sort=unit&dir=desc");
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Vehicle")!.vm.$emit("update:modelValue", "v1");
    await flushPromises();
    expect(query()).toEqual({ vehicle: "v1", sort: "unit", dir: "desc" });

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ sort: "unit", dir: "desc" });
  });
});
