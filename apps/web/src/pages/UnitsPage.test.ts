import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { RoadsideRepairDueDto, UnitAttentionDto, UnitKitDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Trucks & trailers (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, M3; D-MX2, D-MX5).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **Opening on everything.** The list opens on what needs attention; a reader who lands on 240
 *      rows has the page this replaced. "Every truck and trailer" is one tap away, never the default.
 *   2. **A sentence of its own.** The reason is the server's (`/units/attention`); the page words the
 *      FIRST one, and the truck's page words the same row. A page that derived "missing 2" from the
 *      kit lines would disagree with the truck's page the day the rule changed.
 *   3. **Roadside repairs matched by the roster id.** FMCSA's record carries none; the unit the
 *      officer WROTE is the match (D-IC7), as the roadside card does.
 *   4. **The URL carries the ROSTER's kind.** A reefer is a `trailer` as far as the fleet tables are
 *      concerned, and a link that sent `reefer_trailer` would 400 at the API.
 */

const TRUCK = "11111111-1111-4111-8111-111111111111";
const REEFER = "33333333-3333-4333-8333-333333333333";

const unit = (over: Partial<UnitKitDto> = {}): UnitKitDto => ({
  kind: "tractor",
  unitId: TRUCK,
  unitNumber: "654",
  inferredDriverName: "Dana Reyes",
  state: "complete",
  shortBy: 0,
  extraBy: 0,
  lastCheckedAt: null,
  lines: [],
  ...over,
});

const units = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
const attention = ref<UnitAttentionDto[]>([]);
const roadside = ref<RoadsideRepairDueDto[]>([]);

vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitsQuery: () => ({ data: units, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
    useKitExpectationsQuery: () => ({ data: r([]) }),
    useSetKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useDeleteKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/maintenance/useUnitShop", async () => {
  const { ref: r } = await import("vue");
  return { useUnitsAttentionQuery: () => ({ data: attention, isPending: r(false), isError: r(false), refetch: vi.fn() }) };
});
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r } = await import("vue");
  return { useRoadsideRepairsDueQuery: () => ({ data: roadside, isPending: r(false), isError: r(false), refetch: vi.fn() }) };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return { useAssetTypesQuery: () => ({ data: r([]) }) };
});
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));

const UnitsPage = (await import("@/pages/UnitsPage.vue")).default;
const DataTable = (await import("@silvicom/ui")).DataTable;
const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;

let router: Router;
let push: ReturnType<typeof vi.fn>;
async function page(url = "/shop/units") {
  router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  push = vi.fn().mockResolvedValue(undefined);
  router.push = push as unknown as Router["push"];
  const w = mount(UnitsPage, { global: { plugins: [router], stubs: { SlideOver: true } } });
  await flushPromises();
  return w;
}
const urlQuery = () => router.currentRoute.value.query;
type Mounted = Awaited<ReturnType<typeof page>>;
const showSelect = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;

/** ⚠ Opened through `DataTable`'s own event: jsdom has no width, so the table renders cards and no `<tr>`. */
const openRow = async (w: Mounted, row: UnitKitDto) => {
  const table = w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } };
  table.vm.$emit("row-click", row);
  await w.vm.$nextTick();
};

const due = (over: Partial<RoadsideRepairDueDto> = {}): RoadsideRepairDueDto =>
  ({
    unitId: "ru-1",
    unit: { seq: 1, kind: "tractor", companyNumber: "654" },
    violations: [],
    dueOn: "2026-11-02",
    proposal: { outcome: "no_candidate", candidates: [], readAt: "2026-10-28T00:00:00Z" },
    decision: null,
    inspection: { id: "i1", reportNumber: null, reportState: "IL", inspectionDate: "2026-10-18", locationDesc: null },
    ...over,
  }) as unknown as RoadsideRepairDueDto;

beforeEach(() => {
  setActivePinia(createPinia());
  units.value = { units: [], total: 0 };
  attention.value = [];
  roadside.value = [];
});

describe("opening on what needs attention", () => {
  const fleet = () => [unit(), unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer", inferredDriverName: null })];

  it("lists only the units with a reason, and words the server's FIRST reason", async () => {
    units.value = { units: fleet(), total: 2 };
    attention.value = [
      { kind: "tractor", unitId: TRUCK, unitNumber: "654", reasons: [{ kind: "defect", count: 2, oldestDetectedAt: null }, { kind: "short", shortBy: 1, lastCheckedAt: null }] },
    ];
    const w = await page();
    expect(w.text()).toContain("654");
    expect(w.text()).toContain("2 defects found on inspections are not fixed");
    expect(w.text()).not.toContain("Missing 1 piece");
    expect(w.text()).not.toContain("R-8800");
    expect(w.text()).toContain("1 truck or trailer");
    expect(showSelect(w).props("modelValue")).toBe("attention");
    // The default view is the URL a reader lands on: nothing written to it.
    expect(urlQuery()).toEqual({});
  });

  it("puts a roadside repair due on the list by the unit the officer wrote (D-IC7), not by a roster id", async () => {
    units.value = { units: fleet(), total: 2 };
    roadside.value = [due({ unit: { seq: 1, kind: "trailer", companyNumber: "R-8800" } })];
    const w = await page();
    expect(w.text()).toContain("R-8800");
    expect(w.text()).toContain("Roadside violations to repair and certify");
    expect(w.text()).not.toContain("654");
  });

  it("says so when nothing needs attention, and every truck is one tap away", async () => {
    units.value = { units: fleet(), total: 2 };
    const w = await page();
    expect(w.text()).toContain("Nothing needs the shop's attention today");
    showSelect(w).vm.$emit("update:modelValue", "all");
    await flushPromises();
    expect(w.text()).toContain("654");
    expect(w.text()).toContain("R-8800");
    expect(w.text()).toContain("Nothing today");
    expect(urlQuery()).toEqual({ show: "all" });
  });

  it("a row is three facts: the number, the sentence, and when it was last checked — no Kind, no Missing", async () => {
    units.value = { units: [unit({ lastCheckedAt: "2026-10-20T12:00:00.000Z" })], total: 1 };
    attention.value = [{ kind: "tractor", unitId: TRUCK, unitNumber: "654", reasons: [{ kind: "short", shortBy: 2, lastCheckedAt: "2026-10-20T12:00:00.000Z" }] }];
    const w = await page();
    const labels = (w.findComponent({ name: "DataTable" }).props("columns") as { label: string }[]).map((c) => c.label);
    expect(labels).toEqual(["Number", "Needs", "Last checked"]);
    expect(w.text()).toContain("Missing 2 pieces of equipment");
    expect(w.text()).toContain("10/20/2026");
  });

  it("says Never for a unit nobody has checked", async () => {
    units.value = { units: [unit()], total: 1 };
    expect((await page("/shop/units?show=all")).text()).toContain("Never");
  });
});

describe("the other views", () => {
  /** M7 (§7a.4): "Missing equipment" moved to Equipment's On trucks tab; a bookmark follows it there. */
  it("sends the old ?show=short to Equipment's On trucks, its kind and search carried", async () => {
    const r = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
    await r.push("/shop/units?show=short&kind=trailer&search=R-8");
    expect(r.currentRoute.value.path).toBe("/shop/assets");
    expect(r.currentRoute.value.query).toEqual({ kind: "trailer", search: "R-8", tab: "on-trucks", show: "missing" });
  });

  it("offers needs attention and everything under Show, and no longer Missing equipment", async () => {
    const w = await page("/shop/units");
    expect((showSelect(w).props("options") as Array<{ value: string }>).map((o) => o.value)).toEqual(["attention", "all"]);
  });

  it("finds a unit by number, and says so when none matches", async () => {
    units.value = { units: [unit(), unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer" })], total: 2 };
    const w = await page("/shop/units?show=all");
    vi.useFakeTimers();
    try {
      const type = async (value: string) => {
        await w.find("input[type='search'], input[type='text']").setValue(value);
        vi.advanceTimersByTime(300);
        await w.vm.$nextTick();
      };
      await type("R-88");
      expect(w.text()).toContain("R-8800");
      expect(w.text()).not.toContain("654");
      await type("zzz");
      expect(w.text()).toContain("No truck or trailer number matches that.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pages the fleet twenty at a time and counts the whole of it in the toolbar", async () => {
    units.value = { units: Array.from({ length: 25 }, (_, i) => unit({ unitId: `u${i}`, unitNumber: `T-${String(i).padStart(3, "0")}` })), total: 25 };
    const w = await page("/shop/units?show=all");
    expect(w.text()).toContain("25 trucks and trailers");
    expect(w.text()).toContain("T-019");
    expect(w.text()).not.toContain("T-020");
    expect(w.text()).toContain("Showing 1–20 of 25");
  });

  it("leaves what a truck should carry to Equipment (M7), and gives every row a menu", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page("/shop/units?show=all");
    expect(w.text()).not.toContain("What each truck should carry");
    expect(w.find('button[aria-label="Actions"]').exists()).toBe(true);
  });

  it("links a reefer by the roster's kind, not by its kit kind — and a truck as a tractor", async () => {
    units.value = { units: [unit({ kind: "reefer_trailer", unitId: REEFER, unitNumber: "R-8800", inferredDriverName: null }), unit()], total: 2 };
    const w = await page("/shop/units?show=all");
    await openRow(w, units.value.units[0]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "trailer", id: REEFER } });
    await openRow(w, units.value.units[1]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "tractor", id: TRUCK } });
  });
});

/** D-US2: the list's filters, sort and page are the URL, so reload, a pasted link and Back keep them. */
describe("the list in the URL (D-US2)", () => {
  const fleet = () => Array.from({ length: 25 }, (_, i) => unit({ unitId: `u${i}`, unitNumber: `T-${String(i).padStart(3, "0")}` }));

  it("reads the sort and the page back from a pasted link", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?show=all&sort=unitNumber&dir=desc&page=2");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "unitNumber", dir: "desc" });
    expect(w.text()).toContain("Showing 21–25 of 25");
    expect(w.text()).toContain("T-000");
    expect(w.text()).not.toContain("T-024");
  });

  it("writes a filter and a header click to the URL, and a re-sort returns to page 1", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?show=all&page=2");
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Kind")!.vm.$emit("update:modelValue", "tractor");
    await flushPromises();
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "lastCheckedAt");
    await flushPromises();
    expect(urlQuery()).toEqual({ show: "all", kind: "tractor", sort: "lastCheckedAt", dir: "asc" });
  });

  it("Clear filters keeps the sort and returns to needs attention", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?show=all&kind=trailer&search=T-&sort=lastCheckedAt&dir=desc");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(urlQuery()).toEqual({ sort: "lastCheckedAt", dir: "desc" });
    expect(showSelect(w).props("modelValue")).toBe("attention");
  });

  it("reads a kind, a view or a sort column it does not have as none", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?kind=reefer_trailer&show=kit&sort=partNumber");
    expect(w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Kind")!.props("modelValue")).toBe("");
    expect(showSelect(w).props("modelValue")).toBe("attention");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
  });
});

// `computed` is imported for the org-timezone mock other suites share; the page no longer reads a zone.
void computed;
