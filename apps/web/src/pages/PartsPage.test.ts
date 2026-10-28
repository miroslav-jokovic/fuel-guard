import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { PartDto, StockLineDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * The parts list (INVENTORY-PLAN.md I4; aligned with the rest of the product 2026-09-10).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **A filter that loads as applied.** `FilterSelect` reads any non-empty value as a filter in
 *      force and draws a ✕ that emits `""`. The page shipped with `"all"` as its resting value, so
 *      the chip opened blue with a ✕ that cleared it to a value none of its options had — and only
 *      a render showed it. The resting value is `""`, as on every other list.
 *   2. **The home's link must land on the low-stock view.** `?stock=low` is the whole of the
 *      low-stock tile's meaning — and since D-US2 it is one of the list's URL parameters (search,
 *      sort, page, the drawer's `new`) rather than the only query the page reads.
 *   3. **A row must be reachable without a mouse.** The kebab's "Open part" is the keyboard's path
 *      into a row; `@row-click` is the mouse's.
 */

const part = (over: Partial<PartDto> = {}): PartDto => ({
  id: "p1",
  partNumber: "LF9009",
  description: "Oil filter",
  manufacturer: "Fleetguard",
  category: "Filters",
  unitOfMeasure: "each",
  upc: null,
  imagePath: null,
  lastCost: null,
  active: true,
  notes: null,
  ...over,
});

const line = (over: Partial<StockLineDto> = {}): StockLineDto => ({
  partId: "p1",
  partNumber: "LF9009",
  partDescription: "Oil filter",
  locationId: "l1",
  locationName: "Main shelf",
  aisle: null,
  row: null,
  bin: null,
  unitOfMeasure: "each",
  quantityOnHand: 2,
  reorderPoint: 6,
  reorderQuantity: 24,
  tagCode: null,
  lastCost: null,
  active: true,
  ...over,
});

const catalogue = ref<{ parts: PartDto[]; total: number }>({ parts: [], total: 0 });
const low = ref<{ lines: StockLineDto[]; total: number }>({ lines: [], total: 0 });

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    usePartsQuery: () => ({ data: catalogue, isLoading: r(false), error: r(null), refetch: vi.fn() }),
    useLowStockQuery: () => ({ data: low, isLoading: r(false), error: r(null), refetch: vi.fn() }),
  };
});
// The real shape (SP5): the Labels button asks whether the Labels screen opens (`useOpens`).
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("technician");
  return { useSessionStore: () => s, __session: s };
});

const PartsPage = (await import("@/pages/PartsPage.vue")).default;
const DataTable = (await import("@silvicom/ui")).DataTable;
const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;

/**
 * A REAL router over the app's own route table (D-US2): the page keeps its filters in the URL through
 * `useQueryState`, which awaits `router.replace`, and `useOpens()` (SP5) answers the Labels button
 * from whichever router is installed — so the route table here is the app's, not a hand-written one.
 */
let router: Router;
async function mountAt(url = "/shop/inventory") {
  router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  const w = mount(PartsPage, { global: { plugins: [router], stubs: { PartDrawer: true, LocationsDrawer: true } } });
  await flushPromises();
  return w;
}
const page = mountAt;
const urlQuery = () => router.currentRoute.value.query;

type Mounted = Awaited<ReturnType<typeof mountAt>>;
const clearButtons = (w: Mounted) =>
  w.findAll("button").filter((b) => (b.attributes("aria-label") ?? "").startsWith("Clear "));

beforeEach(() => {
  setActivePinia(createPinia());
  catalogue.value = { parts: [part()], total: 1 };
  low.value = { lines: [line()], total: 1 };
});

// jsdom has no `matchMedia`, so DataTable would render its phone cards, and a card shows only its
// three marked facts (DESIGN-SYSTEM-CONTRACT.md §9 rule 3). These read the columns, which is a table's
// question, so the viewport is a desktop one.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (media: string) => ({
    matches: true, media, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

describe("the stock filter", () => {
  it("opens with nothing applied — no ✕ to clear a filter nobody set", async () => {
    const w = await page();
    expect(clearButtons(w)).toHaveLength(0);
    expect(w.text()).toContain("1 part");
  });

  it("reads the home's ?stock=low as the low-stock view, which is a filter in force", async () => {
    const w = await page("/shop/inventory?stock=low");
    expect(clearButtons(w)).toHaveLength(1);
    expect(w.text()).toContain("1 shelf");
    expect(w.text()).toContain("Main shelf");
  });

  it("offers Clear filters on the low-stock view, and clearing returns to the whole catalogue", async () => {
    const w = await page("/shop/inventory?stock=low");
    const clearFilters = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    await clearFilters()!.trigger("click");
    await flushPromises();
    expect(clearButtons(w)).toHaveLength(0);
    expect(clearFilters()).toBeUndefined();
    expect(w.text()).toContain("1 part");
    expect(urlQuery()).toEqual({});
  });
});

/** D-US2: the list's filters, sort and page are the URL, so reload, a pasted link and Back keep them. */
describe("the list in the URL (D-US2)", () => {
  const lines = [
    line({ locationId: "l1", locationName: "Main shelf", quantityOnHand: 2 }),
    line({ locationId: "l2", locationName: "Back room", quantityOnHand: 5 }),
    line({ locationId: "l3", locationName: "Cage", quantityOnHand: 0 }),
  ];
  const locations = (w: Mounted) =>
    w.findComponent({ name: "DataTable" }).props("rows").map((r: Record<string, unknown>) => r.locationName);

  it("reads the low-stock view and its sort back from a pasted link", async () => {
    low.value = { lines, total: 3 };
    const w = await page("/shop/inventory?stock=low&sort=quantityOnHand&dir=desc");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "quantityOnHand", dir: "desc" });
    expect(locations(w)).toEqual(["Back room", "Main shelf", "Cage"]);
  });

  it("writes the Stock choice and a header click to the URL", async () => {
    low.value = { lines, total: 3 };
    const w = await page();
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!.vm.$emit("update:modelValue", "low");
    await flushPromises();
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "locationName");
    await flushPromises();
    expect(urlQuery()).toEqual({ stock: "low", sort: "locationName", dir: "asc" });
    expect(locations(w)).toEqual(["Back room", "Cage", "Main shelf"]);
  });

  it("Clear filters keeps the sort, and a sort from another table reads as none", async () => {
    const w = await page("/shop/inventory?stock=low&search=oil&sort=reorderPoint&dir=desc");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(urlQuery()).toEqual({ sort: "reorderPoint", dir: "desc" });

    const foreign = await page("/shop/inventory?stock=low&sort=description");
    expect(foreign.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
  });

  it("opens the drawer from ?new=1 and closing it keeps the filters", async () => {
    const w = await page("/shop/inventory?stock=low&new=1");
    const drawer = w.findComponent({ name: "PartDrawer" });
    expect(drawer.props("open")).toBe(true);
    drawer.vm.$emit("close");
    await flushPromises();
    expect(urlQuery()).toEqual({ stock: "low" });
  });
});

describe("the header", () => {
  it("names what its buttons open, rather than showing an unlabelled gear", async () => {
    const text = (await page()).text();
    expect(text).toContain("Places");
    expect(text).toContain("New part");
  });
});

/**
 * SP5 (plan §4b): Labels is `maintenance` view and answers to the shop home's screen
 * (`maintenance.repair-spend`, D-SURF8), switchable per person apart from Parts. The button asked
 * `maintenance` MANAGE, which hid it from a viewer the Labels page admits and kept it for a person
 * whose shop home was switched off.
 */
describe("the Labels button (SP5)", () => {
  const session = async () =>
    ((await import("@/stores/session")) as unknown as { __session: import("@/testing/fakeSession").FakeSession }).__session;
  it("shows where Labels opens and not where it is off for this person", async () => {
    const s = await session();
    const labels = async () => (await page()).findAll("a, button").filter((b) => b.text().trim() === "Labels");
    expect(await labels()).toHaveLength(1);
    s.surfaces = { "maintenance.repair-spend": false };
    try {
      expect(await labels()).toHaveLength(0);
    } finally {
      s.surfaces = null;
    }
  });
});

describe("opening a row", () => {
  it("gives every row a menu, so a keyboard can reach what a click can", async () => {
    const w = await page();
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    // The menu's items render only once it is open; the trigger is what proves the path exists.
    expect(w.find('button[aria-label="Actions"]').exists()).toBe(true);
    const table = w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } };
    table.vm.$emit("row-click", part());
    await w.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: "part", params: { id: "p1" } });
  });
});
