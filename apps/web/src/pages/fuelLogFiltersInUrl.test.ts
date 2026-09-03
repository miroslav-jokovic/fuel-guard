import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";
import type { EfsFilters } from "@/features/fuel/useEfsData";
import type { FuelFilters } from "@/features/fuel/useFuelLog";

/**
 * FUEL-C3, D-FUI8 — the Fuel Log survives a refresh and can be pasted into a ticket.
 *
 * C2 put the tab, the window and the truck in the URL and left each tab's OWN facets in local refs,
 * saying so in the plan rather than leaving it to be rediscovered. This is that half, and the reason
 * it was worth deferring rather than doing carelessly is the collision:
 *
 *   · `driver` is a driver ID on Fills and a driver NAME on the two raw feeds. One shared parameter
 *     carries a UUID into a name filter and returns an empty list with no error anywhere.
 *   · `sort` names a COLUMN. `fueled_at` is the Fills tab's; carried onto `declined_transactions` it
 *     is not a filter that matches nothing, it is a query that errors.
 *
 * So the facets belong to the open tab, the tab switch clears them, and each tab checks what it reads
 * against its own vocabulary. Those three sentences are what this file asserts.
 */

const session = vi.hoisted(() => ({ role: "admin" as string | null, can: () => true, canView: () => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

const seen = vi.hoisted(() => ({
  fuel: null as { value: FuelFilters } | null,
  txn: null as { value: EfsFilters } | null,
  declined: null as { value: EfsFilters } | null,
}));

const listOf = (row: Record<string, unknown>) => ({
  data: ref({ rows: [row], total: 1 }),
  isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
});

vi.mock("@/features/fuel/useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useEfsTransactions: (f: { value: EfsFilters }) => {
    seen.txn = f;
    return listOf({ id: "t1", unit: "654", tran_date: "2026-08-15", fueled_at: "2026-08-15T14:00:00Z", state: "TX" });
  },
  useDeclinedTransactions: (f: { value: EfsFilters }) => {
    seen.declined = f;
    return listOf({ id: "d1", unit: "654", declined_at: "2026-08-15T14:00:00Z", error_code: "51", state: "TX" });
  },
  useEfsFacets: () => ({ data: ref(undefined) }),
  useEfsRowCoverage: () => ({ data: ref(null) }),
}));
vi.mock("@/features/fuel/useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: (f: { value: FuelFilters }) => {
    seen.fuel = f;
    return listOf({ id: "f1", vehicle_id: "v-654", driver_id: "dr-1", fueled_at: "2026-08-15T14:00:00Z", gallons: 100, has_anomaly: false, case_level: "clear", case_score: 0, case_signals: [], case_gates: null });
  },
  useFuelRangeTotals: () => ({ data: ref(null) }),
  useCreateFillUp: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v-654", unit_number: "654", status: "active" }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => ({ data: ref([{ id: "dr-1", full_name: "A Driver" }]) }),
}));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: ref([]) }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

import FuelLogPage from "./FuelLogPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-log", component: { template: "<div/>" }, meta: { title: "Fuel Log" } }],
  });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelLogPage, { global: { plugins: [router, pinia, VueQueryPlugin] } });
  await flushPromises();
  return { w, router, query: () => router.currentRoute.value.query };
}

/** Drive a filter through the control the reader uses, found by the label on its trigger. */
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const pick = async (w: Mounted, label: string, value: string) => {
  const control = w.findAllComponents(FilterSelect).find((c) => c.props("label") === label);
  expect(control, `no "${label}" filter on this tab`).toBeTruthy();
  control!.vm.$emit("update:modelValue", value);
  await flushPromises();
};
const clickTab = async (w: Mounted, label: string) => {
  const tab = w.findAll('[role="tab"]').find((b) => b.text().trim() === label);
  expect(tab, `no "${label}" tab`).toBeTruthy();
  await tab!.trigger("click");
  await flushPromises();
};

const settle = () => flushPromises();

beforeEach(() => {
  seen.fuel = seen.txn = seen.declined = null;
});

describe("the Fuel Log's filters round-trip through the query string", () => {
  it("puts a facet chosen on the Fills tab into the URL, and the query", async () => {
    const { w, query } = await mountAt("/fuel-log");
    await pick(w, "Fuel", "reefer");
    expect(query().tank).toBe("reefer");
    expect(seen.fuel?.value.tankType).toBe("reefer");
  });

  it("reads that facet back out of a link, without the reader touching a control", async () => {
    await mountAt("/fuel-log?tank=reefer&search=654");
    expect(seen.fuel?.value.tankType).toBe("reefer");
    expect(seen.fuel?.value.search).toBe("654");
    // The smart search resolves against the fleet on the way in, so a LINK narrows by unit exactly
    // as a keystroke does. Two writers for that fact is how they stop agreeing.
    expect(seen.fuel?.value.searchVehicleIds).toEqual(["v-654"]);
  });

  it("puts each raw-feed tab's own facets in the URL under its own names", async () => {
    const dec = await mountAt("/fuel-log?tab=declines");
    await pick(dec.w, "Risk", "alert");
    await pick(dec.w, "Error", "51");
    expect(dec.query()).toMatchObject({ risk: "alert", error: "51" });
    expect(seen.declined?.value.suspicion).toBe("alert");
    expect(seen.declined?.value.errorCode).toBe("51");

    const src = await mountAt("/fuel-log?tab=source");
    await pick(src.w, "Item", "ULSD");
    expect(src.query().item).toBe("ULSD");
    expect(seen.txn?.value.item).toBe("ULSD");
  });

  /**
   * ⚠ The two-`v-model`-in-one-tick case that welded the spend window to 90 days. `DateRangeFilter`
   * emits `update:from` and `update:to` back to back, both setters read the same not-yet-updated
   * `route.query`, and without the buffer the second navigation overwrites the first — `to` applied,
   * `from` silently dropped. Both halves work in isolation, which is why one-at-a-time tests pass.
   */
  it("keeps both ends of a window set in one tick", async () => {
    const { w, query } = await mountAt("/fuel-log");
    const picker = w.findComponent(DateRangeFilter);
    picker.vm.$emit("update:from", "2026-08-01");
    picker.vm.$emit("update:to", "2026-08-31");
    await settle();

    expect(query()).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(seen.fuel?.value.from).toBe("2026-08-01");
    expect(seen.fuel?.value.to).toBe("2026-08-31");
  });

  it("keeps a shared filter and a tab-owned one set in the same tick", async () => {
    const { w, query } = await mountAt("/fuel-log?tab=declines");
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Unit")!.vm.$emit("update:modelValue", "654");
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Risk")!.vm.$emit("update:modelValue", "review");
    await settle();
    expect(query()).toMatchObject({ unit: "654", risk: "review" });
  });

  it("clears the screen — both halves — and leaves the tab where it is", async () => {
    const { w, query } = await mountAt("/fuel-log?tab=declines&unit=654&from=2026-08-01&risk=alert&policy=P1");
    w.findComponent(FilterBar).vm.$emit("clearAll");
    await settle();
    expect(query().tab).toBe("declines");
    for (const key of ["unit", "from", "risk", "policy"]) expect(query()[key], key).toBeUndefined();
  });
});

describe("the shared filters cross a tab change and the tab's own do not", () => {
  it("carries the window and the truck, and drops the outgoing tab's facets", async () => {
    const { w, query } = await mountAt("/fuel-log?tab=declines&unit=654&from=2026-08-01&risk=alert&policy=P1");
    await clickTab(w, "Source records");

    expect(query()).toMatchObject({ tab: "source", unit: "654", from: "2026-08-01" });
    expect(query().risk).toBeUndefined();
    expect(query().policy).toBeUndefined();
    expect(seen.txn?.value.unit).toBe("654");
  });

  /**
   * ⚠ The collision the split exists for. `driver` is a UUID on Fills and a name on the raw feeds;
   * if it crossed, the declines list would come back empty with nothing on screen saying why.
   */
  it("does not carry a driver ID into a tab whose driver filter is a name", async () => {
    const { w, query } = await mountAt("/fuel-log?driver=dr-1");
    expect(seen.fuel?.value.driverId).toBe("dr-1");
    await clickTab(w, "Declines");
    expect(query().driver).toBeUndefined();
    expect(seen.declined?.value.driver).toBeUndefined();
  });

  /**
   * ⚠ And the collision that would not fail quietly. A sort key reaches PostgREST's `.order()`, so
   * `fueled_at` — the Fills tab's own column — against `declined_transactions` is an error state
   * rather than an empty list. It is refused on the way in as well as dropped on the way across.
   */
  it("refuses another table's sort key, whether it crosses a tab or arrives in a link", async () => {
    const { w, query } = await mountAt("/fuel-log?sort=fueled_at&dir=desc");
    expect(seen.fuel?.value.sortKey).toBe("fueled_at");
    await clickTab(w, "Declines");
    expect(query().sort).toBeUndefined();
    expect(seen.declined?.value.sortKey).toBeUndefined();

    await mountAt("/fuel-log?tab=declines&sort=fueled_at&dir=desc");
    expect(seen.declined?.value.sortKey).toBeUndefined();
  });

  it("sorts by a column the open tab does have, and says so in the URL", async () => {
    const { w, query } = await mountAt("/fuel-log?tab=declines");
    // The button INSIDE the header cell, which is what `DataTable` puts on a sortable column — a
    // click on the `th` itself does nothing, and asserting against that would pass for no reason.
    const header = w.findAll("th button").find((b) => b.text().trim().startsWith("Unit"));
    expect(header, "no sortable Unit header").toBeTruthy();
    await header!.trigger("click");
    await settle();
    expect(query()).toMatchObject({ sort: "unit", dir: "asc" });
    expect(seen.declined?.value.sortKey).toBe("unit");
  });
});
