import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { PartUsageListDto, PartUsageRowDto, StockLineDto } from "@silvicom/shared";
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
 *   4. **The list asks the server for the order (SP-U2).** No sort = most used first; a header click
 *      becomes `shop_parts_list`'s own sort word, and "All parts" widens the list — a page that sorted
 *      its fifty rows itself would show a page-local order as the catalogue's.
 */

const part = (over: Partial<PartUsageRowDto> = {}): PartUsageRowDto => ({
  id: "p1",
  partNumber: "LF9009",
  description: "Oil filter",
  unitOfMeasure: "each",
  fleetpalId: "fp-1",
  usedQuantity: 31,
  usedRepairs: 31,
  lastUsedAt: "2026-10-30T15:00:00.000Z",
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

const catalogue = ref<PartUsageListDto>({ rows: [], total: 0, windowDays: 90 });
// The last filter the page handed the usage query — what the server is asked for.
const asked = vi.hoisted(() => ({ filter: null as null | { value: Record<string, unknown> } }));
const low = ref<{ lines: StockLineDto[]; total: number }>({ lines: [], total: 0 });

// The shelf-counting flag (Q-MX8) as a live getter, so one file tests the hidden page AND the kept code.
const flags = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/shelfCounting", () => ({
  get SHELF_COUNTING_SHOWN() {
    return flags.shown;
  },
}));
vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    useLowStockQuery: () => ({ data: low, isLoading: r(false), error: r(null), refetch: vi.fn() }),
  };
});
vi.mock("@/features/inventory/usePartUsage", async () => {
  const { ref: r } = await import("vue");
  return {
    usePartUsageListQuery: (filter: { value: Record<string, unknown> }) => {
      asked.filter = filter;
      return { data: catalogue, isLoading: r(false), error: r(null), refetch: vi.fn() };
    },
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
  catalogue.value = { rows: [part()], total: 1, windowDays: 90 };
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
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Stock")!.vm.$emit("update:modelValue", "low");
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

});

describe("the header", () => {
  it("names what its buttons open, rather than showing an unlabelled gear", async () => {
    const text = (await page()).text();
    expect(text).toContain("Places");
  });
});

/**
 * M8 (§7a.5) — the page as it ships: FleetPal's catalogue, shelf counting hidden (Q-MX8). Everything
 * above runs with the flag ON, because the shelf code is kept and must keep working the day it is on.
 */
describe("Shop parts as it ships: FleetPal's list, shelf counting hidden", () => {
  beforeEach(() => (flags.shown = false));
  afterEach(() => (flags.shown = true));

  it("says where the list comes from and where it is changed, and offers no New part", async () => {
    const text = (await page()).text();
    expect(text).toContain("Parts the shop puts on trucks and trailers, from FleetPal's repair orders. Add and change parts in FleetPal.");
    expect(text).not.toContain("New part");
    expect(text).not.toContain("Places");
    expect(text).not.toContain("Labels");
  });

  it("draws no Running low filter, and opens an old ?stock=low link on the list", async () => {
    low.value = { lines: [line({ locationId: "l1", locationName: "Main shelf" })], total: 1 };
    const w = await page("/shop/inventory?stock=low");
    expect(w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Stock")).toBeUndefined();
    expect(w.findComponent({ name: "DataTable" }).props("rows")).toEqual(catalogue.value.rows);
  });

  it("labels only a hand-typed part — FleetPal's is every row, and the header says so once (D-SPU6)", async () => {
    catalogue.value = { rows: [part({ fleetpalId: "fp-1" }), part({ id: "p2", partNumber: "X1", fleetpalId: null })], total: 2, windowDays: 90 };
    const w = await page();
    expect(w.findAll('[data-test="from-fleetpal"]')).toHaveLength(0);
    const marks = w.findAll('[data-test="added-here"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.element.textContent).toBe(" · Added here");
  });

  it("shows no Manufacturer, Category or price column — blank on every FleetPal part, and money waits on D-FP4", async () => {
    const labels = (await page()).findComponent({ name: "DataTable" }).props("columns").map((c: { label: string }) => c.label);
    expect(labels).toEqual(["Part number", "Description", "Used, last 90 days", "Repairs", "Last used"]);
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

/** SP-U2: what the page asks the server for — the order and the width of the list are the server's. */
describe("what the list asks for (SP-U2)", () => {
  beforeEach(() => (flags.shown = false));
  afterEach(() => (flags.shown = true));
  const filter = () => asked.filter!.value;

  it("opens on parts used in the last 90 days, most used first, with the Show chip unapplied", async () => {
    const w = await page();
    expect(filter()).toMatchObject({ show: "used", sort: "used", descending: true, page: 1 });
    const showChip = w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;
    expect(showChip.props("modelValue")).toBe("");
    expect(clearButtons(w)).toHaveLength(0);
  });

  it("All parts widens the list and is written to the URL", async () => {
    const w = await page();
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!.vm.$emit("update:modelValue", "all");
    await flushPromises();
    expect(urlQuery()).toEqual({ show: "all" });
    expect(filter().show).toBe("all");
  });

  it("a header click becomes the server's own sort word, and the URL keeps it", async () => {
    const w = await page();
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "lastUsedAt");
    await flushPromises();
    expect(urlQuery()).toEqual({ sort: "lastUsedAt", dir: "asc" });
    expect(filter()).toMatchObject({ sort: "last_used", descending: false });
  });

  it("a pasted link's sort and search reach the server; a shelf column's sort reads as none", async () => {
    await page("/shop/inventory?sort=usedRepairs&dir=desc&search=%20brake%20");
    expect(filter()).toMatchObject({ sort: "repairs", descending: true, search: "brake" });
    const w = await page("/shop/inventory?sort=locationName&dir=desc");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
    expect(filter()).toMatchObject({ sort: "used", descending: true });
  });

  it("reads a never-used part as Never, and a fractional quantity without trailing zeros", async () => {
    catalogue.value = { rows: [part({ lastUsedAt: null, usedQuantity: 0, usedRepairs: 0 }), part({ id: "p2", usedQuantity: 12.5 })], total: 2, windowDays: 90 };
    const text = (await page("/shop/inventory?show=all")).text();
    expect(text).toContain("Never");
    expect(text).toContain("12.5");
    expect(text).toContain("10/30/2026");
  });

  it("an empty used view says so and points at All parts, not 'no parts yet'", async () => {
    catalogue.value = { rows: [], total: 0, windowDays: 90 };
    const text = (await page()).text();
    expect(text).toContain("No part went on a repair in the last 90 days");
    expect(text).not.toContain("No parts yet");
  });
});
