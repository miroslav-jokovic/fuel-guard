import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { UnitKitDto, UnitKitLineDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Equipment (M7; EA2 — EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL §3.4): three tabs by who holds a thing —
 * Trucks & trailers, Drivers, In the shop.
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *   1. **Opening on the wrong list**, or an M7 link (`on-trucks`, `inventory`) landing nowhere.
 *   2. **Showing Should carry while it is hidden** (`KIT_RULES_SHOWN`) — and, with it on, calling a
 *      never-checked unit missing (R10). The switch is a live getter here so the kept code stays tested.
 *   3. **Asking the API for the wrong pile**: Drivers is `holder=driver`, In the shop `holder=shop`,
 *      and *Where › Anywhere* asks with no holder at all.
 *   4. **A row that opens the truck's page on the wrong tab.** It opens Equipment, by the ROSTER's
 *      kind — a reefer is a `trailer` to the fleet tables.
 */
const kit = vi.hoisted(() => ({ shown: false }));
vi.mock("@silvicom/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@silvicom/shared")>()),
  get KIT_RULES_SHOWN() {
    return kit.shown;
  },
}));



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
/** What a driver holds, answered only to the Drivers tab's `holder=driver` ask. */
const driverRows = ref<unknown[]>([]);
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    ASSETS_PAGE_SIZE: 50,
    useAssetsQuery: (f: { value: Record<string, unknown> }) => {
      assetFilters.push(f);
      const rows = f.value.holder === "driver" ? driverRows.value : [];
      return { data: r({ assets: rows, total: 7 }), isLoading: r(false), isError: r(false), refetch: vi.fn() };
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
  driverRows.value = [];
  kit.shown = false;
});

const empty = () => unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer", lastCheckedAt: null, lines: [] });

describe("Equipment's three tabs", () => {
  it("opens on Trucks & trailers and counts what each tab lists — no Should carry while it is hidden", async () => {
    units.value = { units: [unit({ state: "short", shortBy: 2 }), empty()], total: 2 };
    const w = await page();
    expect(w.findComponent(AppTabs).props("modelValue")).toBe("trucks");
    expect(tabsOf(w)).toEqual([
      { value: "trucks", label: "Trucks & trailers", badge: 1 },
      { value: "drivers", label: "Drivers", badge: 7 },
      { value: "shop", label: "In the shop", badge: 7 },
    ]);
    expect(w.text()).not.toContain("What each truck should carry");
    expect(w.text()).toContain("Types of equipment");
    // The tab counts ask exactly the piles their panels list.
    expect(assetFilters.map((f) => f.value)).toEqual(
      expect.arrayContaining([{ holder: "driver", page: 1 }, { holder: "shop", page: 1 }]),
    );
  });

  it("lands an M7 link on the tab it meant", async () => {
    expect((await page("/shop/assets?tab=on-trucks")).findComponent(AppTabs).props("modelValue")).toBe("trucks");
    const w = await page("/shop/assets?tab=inventory&search=strap");
    expect(w.findComponent(AppTabs).props("modelValue")).toBe("shop");
    expect(router.currentRoute.value.query).toEqual({ tab: "shop", search: "strap" });
  });

  it("words what a truck carries — a tablet with its driver — and never a shortfall while Should carry is hidden", async () => {
    units.value = { units: [unit({ state: "short", shortBy: 2 })], total: 1 };
    const w = await page();
    expect(w.find('[data-test="on-board"]').text()).toBe("Tablet (Dana Reyes), 2 × Load bar");
    expect(w.text()).toContain("10/20/2026");
  });

  it("lists the units carrying something, and every unit or the never-checked one tap away", async () => {
    units.value = { units: [unit(), empty()], total: 2 };
    const carrying = await page();
    expect(carrying.text()).toContain("654");
    expect(carrying.text()).not.toContain("R-8800");
    const all = await page("/shop/assets?show=all");
    expect(all.text()).toContain("R-8800");
    expect(all.text()).toContain("Nothing on board yet");
    const never = await page("/shop/assets?show=never");
    expect(never.text()).toContain("R-8800");
    expect(never.text()).not.toContain("654");
    const show = never.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;
    expect(show.props("modelValue")).toBe("never");
    expect((show.props("options") as Array<{ value: string }>).map((o) => o.value)).not.toContain("missing");
  });

  it("with Should carry shown: the rules button, the missing words, and Missing something leaving out the never-checked", async () => {
    kit.shown = true;
    units.value = {
      units: [unit({ state: "short", shortBy: 1 }), unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer", state: "short", shortBy: 3, lastCheckedAt: null, lines: [] })],
      total: 2,
    };
    const missing = await page("/shop/assets?tab=trucks&show=missing");
    expect(missing.text()).toContain("What each truck should carry");
    expect(missing.find('[data-test="on-board"]').text()).toBe("1 missing · Tablet (Dana Reyes), 2 × Load bar");
    expect(missing.text()).not.toContain("R-8800");
  });

  it("opens a reefer's Equipment tab by the roster's kind", async () => {
    const reefer = unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer" });
    units.value = { units: [reefer], total: 1 };
    const w = await page();
    (w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } }).vm.$emit("row-click", reefer);
    await w.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "trailer", id: REEFER }, query: { tab: "equipment" } });
  });

  it("switches tab without carrying the other list's filters", async () => {
    const w = await page("/shop/assets?show=all&search=65");
    w.findComponent(AppTabs).vm.$emit("update:modelValue", "shop");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ tab: "shop" });
    expect(w.text()).toContain("Types of equipment");
  });
});

describe("In the shop (EA2)", () => {
  it("asks for the shop's pile, and Where › Anywhere asks for everything", async () => {
    await page("/shop/assets?tab=shop");
    expect(assetFilters.at(-1)!.value).toMatchObject({ holder: "shop", page: 1 });
    await page("/shop/assets?tab=shop&where=anywhere");
    expect(assetFilters.at(-1)!.value.holder).toBeUndefined();
  });
});

describe("Tablets not returned on the Drivers tab (DE2b, D-DE3; moved by EA2)", () => {
  it("states the database's count and offers the list, which asks the API for exactly those", async () => {
    notReturned.value = 3;
    const w = await page("/shop/assets?tab=drivers");
    const callout = w.find("[data-test='not-returned-callout']");
    expect(callout.text()).toContain("3 tablets are still with a driver who has left.");
    const returned = w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Returned")!;
    expect(returned.props("options")).toContainEqual({ value: "not-returned", label: "Not returned", count: "3" });

    const filtered = await page("/shop/assets?tab=drivers&returned=not-returned");
    expect(assetFilters.at(-1)!.value).toMatchObject({ holder: "driver", notReturned: true });
    // The warning has done its job once the list is showing them.
    expect(filtered.find("[data-test='not-returned-callout']").exists()).toBe(false);
  });

  it("says nothing when every tablet has come back", async () => {
    const w = await page("/shop/assets?tab=drivers");
    expect(w.find("[data-test='not-returned-callout']").exists()).toBe(false);
    expect(assetFilters.at(-1)!.value.notReturned).toBeUndefined();
  });
});

describe("the Drivers tab (EA2)", () => {
  it("names the driver first and opens the driver's page, where Give and Return are", async () => {
    const tablet = {
      id: "a-1", displayNo: "A-0412", name: "Cab tablet", assetTypeName: "Tablet", imei: "490154203237518",
      holder: { kind: "driver", id: "d-1", label: "Dana Reyes", inferredDriverName: null, since: null, notReturned: true },
    };
    driverRows.value = [tablet];
    const w = await page("/shop/assets?tab=drivers");
    const text = w.findComponent(DataTable).text();
    expect(text).toContain("Dana Reyes");
    expect(text).toContain("Not returned");
    expect(text).toContain("…37518");
    (w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } }).vm.$emit("row-click", tablet);
    await w.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: "driver-detail", params: { id: "d-1" } });
  });
});
