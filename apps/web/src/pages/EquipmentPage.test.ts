import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { UnitKitDto, UnitKitLineDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Equipment (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.4, M7): two tabs, On trucks and Inventory.
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *   1. **Opening on the wrong list.** No `?tab=` is On trucks — the owner's "truck assignment" view.
 *   2. **Calling a never-checked unit missing.** Until its first check a unit is short on paper only
 *      (R10); "Missing something" and the tab's count must leave it out.
 *   3. **A row that opens the truck's page on the wrong tab.** It opens Equipment, by the ROSTER's
 *      kind — a reefer is a `trailer` to the fleet tables.
 */

const TRUCK = "11111111-1111-4111-8111-111111111111";
const REEFER = "33333333-3333-4333-8333-333333333333";

const line = (over: Partial<UnitKitLineDto>): UnitKitLineDto => ({
  assetTypeId: "t",
  assetTypeName: "Load bar",
  heldBy: "unit",
  expected: 2,
  held: 2,
  delta: 0,
  source: "fleet",
  ...over,
});
const unit = (over: Partial<UnitKitDto> = {}): UnitKitDto => ({
  kind: "tractor",
  unitId: TRUCK,
  unitNumber: "654",
  inferredDriverName: "Dana Reyes",
  state: "complete",
  shortBy: 0,
  extraBy: 0,
  lastCheckedAt: "2026-10-20T12:00:00.000Z",
  lines: [line({ assetTypeId: "tab", assetTypeName: "Tablet", heldBy: "driver", expected: 1, held: 1 }), line({})],
  ...over,
});

const units = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });

vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitsQuery: () => ({ data: units, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
    useKitExpectationsQuery: () => ({ data: r([]) }),
    useSetKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useDeleteKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
/** DE2b: the database's *Tablets not returned* count, and every filter the list was asked with. */
const notReturned = ref(0);
const assetFilters: Array<{ value: Record<string, unknown> }> = [];
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    ASSETS_PAGE_SIZE: 50,
    useAssetsQuery: (f: { value: Record<string, unknown> }) => {
      assetFilters.push(f);
      return { data: r({ assets: [], total: 7 }), isLoading: r(false), isError: r(false), refetch: vi.fn() };
    },
    useAssetTypesQuery: () => ({ data: r([]) }),
    useNotReturnedCountQuery: () => ({ data: notReturned }),
  };
});
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));

const AssetsPage = (await import("@/pages/AssetsPage.vue")).default;
const { AppTabs, DataTable } = await import("@silvicom/ui");
const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;

let router: Router;
let push: ReturnType<typeof vi.fn>;
async function page(url = "/shop/assets") {
  router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  push = vi.fn().mockResolvedValue(undefined);
  router.push = push as unknown as Router["push"];
  const w = mount(AssetsPage, { global: { plugins: [router], stubs: { SlideOver: true, AssetDrawer: true, AssetTypesDrawer: true, KitRulesDrawer: true } } });
  await flushPromises();
  return w;
}
type Mounted = Awaited<ReturnType<typeof page>>;
const tabsOf = (w: Mounted) => w.findComponent(AppTabs).props("tabs") as Array<{ value: string; label: string; badge?: number }>;

beforeEach(() => {
  setActivePinia(createPinia());
  units.value = { units: [], total: 0 };
  notReturned.value = 0;
  assetFilters.length = 0;
});

describe("Equipment's two tabs", () => {
  it("opens on On trucks, and counts the units missing something and the items", async () => {
    units.value = {
      units: [
        unit({ state: "short", shortBy: 2 }),
        // Short on paper only: nobody has checked it (R10), so it is not counted as missing.
        unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer", state: "short", shortBy: 3, lastCheckedAt: null, lines: [] }),
      ],
      total: 2,
    };
    const w = await page();
    expect(w.findComponent(AppTabs).props("modelValue")).toBe("on-trucks");
    expect(tabsOf(w)).toEqual([
      { value: "on-trucks", label: "On trucks", badge: 1 },
      { value: "inventory", label: "Inventory", badge: 7 },
    ]);
    expect(w.text()).toContain("What each truck should carry");
    // The page opens here, so the door to the types is here too (owner 2026-10-29).
    expect(w.text()).toContain("Types of equipment");
  });

  it("words what a truck carries — a tablet with its driver — and what is missing", async () => {
    units.value = { units: [unit({ state: "short", shortBy: 2 })], total: 1 };
    const w = await page();
    expect(w.find('[data-test="on-board"]').text()).toBe("2 missing · Tablet (Dana Reyes), 2 × Load bar");
    expect(w.text()).toContain("10/20/2026");
  });

  it("filters to units missing something, leaving out the never-checked", async () => {
    units.value = {
      units: [
        unit({ state: "short", shortBy: 1 }),
        unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer", state: "short", shortBy: 3, lastCheckedAt: null, lines: [] }),
      ],
      total: 2,
    };
    const missing = await page("/shop/assets?tab=on-trucks&show=missing");
    expect(missing.text()).toContain("654");
    expect(missing.text()).not.toContain("R-8800");
    const never = await page("/shop/assets?show=never");
    expect(never.text()).toContain("R-8800");
    expect(never.text()).toContain("Nothing on board yet");
    expect(never.text()).not.toContain("654");
    const show = never.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;
    expect(show.props("modelValue")).toBe("never");
  });

  it("opens a reefer's Equipment tab by the roster's kind", async () => {
    const reefer = unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer" });
    units.value = { units: [reefer], total: 1 };
    const w = await page();
    (w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } }).vm.$emit("row-click", reefer);
    await w.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "trailer", id: REEFER }, query: { tab: "equipment" } });
  });

  it("switches to Inventory without carrying the other list's filters", async () => {
    const w = await page("/shop/assets?show=missing&search=65");
    w.findComponent(AppTabs).vm.$emit("update:modelValue", "inventory");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ tab: "inventory" });
    expect(w.text()).toContain("Types of equipment");
    expect(w.text()).not.toContain("What each truck should carry");
  });
});

describe("Tablets not returned (DE2b, D-DE3)", () => {
  it("states the database's count and offers the list, which asks the API for exactly those", async () => {
    notReturned.value = 3;
    const w = await page("/shop/assets?tab=inventory");
    const callout = w.find("[data-test='not-returned-callout']");
    expect(callout.text()).toContain("3 tablets are still with a driver who has left.");
    const returned = w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Returned")!;
    expect(returned.props("options")).toContainEqual({ value: "not-returned", label: "Not returned", count: "3" });

    const filtered = await page("/shop/assets?tab=inventory&returned=not-returned");
    expect(assetFilters.at(-1)!.value).toMatchObject({ notReturned: true });
    // The warning has done its job once the list is showing them.
    expect(filtered.find("[data-test='not-returned-callout']").exists()).toBe(false);
  });

  it("says nothing when every tablet has come back", async () => {
    const w = await page("/shop/assets?tab=inventory");
    expect(w.find("[data-test='not-returned-callout']").exists()).toBe(false);
    expect(assetFilters.at(-1)!.value.notReturned).toBeUndefined();
  });
});
