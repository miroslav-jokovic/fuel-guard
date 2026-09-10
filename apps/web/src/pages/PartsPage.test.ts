import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { PartDto, StockLineDto } from "@silvicom/shared";

/**
 * The parts list (INVENTORY-PLAN.md I4; aligned with the rest of the product 2026-09-10).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **A filter that loads as applied.** `FilterSelect` reads any non-empty value as a filter in
 *      force and draws a ✕ that emits `""`. The page shipped with `"all"` as its resting value, so
 *      the chip opened blue with a ✕ that cleared it to a value none of its options had — and only
 *      a render showed it. The resting value is `""`, as on every other list.
 *   2. **The home's link must land on the low-stock view.** `?stock=low` is the one query this
 *      page reads, and it is the whole of the low-stock tile's meaning.
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
const query = ref<Record<string, string>>({});
const push = vi.fn();

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    usePartsQuery: () => ({ data: catalogue, isLoading: r(false), error: r(null), refetch: vi.fn() }),
    useLowStockQuery: () => ({ data: low, isLoading: r(false), error: r(null), refetch: vi.fn() }),
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("vue-router", async () => {
  const { h } = await import("vue");
  return {
    useRoute: () => ({ query: query.value, params: {}, meta: { title: "Parts" }, matched: [], path: "/shop/inventory" }),
    useRouter: () => ({ push, replace: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
    // The header's Labels button is a link, and `AppButton` reaches for the router's own component.
    RouterLink: {
      props: ["to"],
      setup(props: { to: unknown }, { slots }: { slots: { default?: () => unknown } }) {
        return () => h("a", { href: String(props.to) }, slots.default?.() as never);
      },
    },
  };
});

const PartsPage = (await import("@/pages/PartsPage.vue")).default;
const DataTable = (await import("@/components/ui/DataTable.vue")).default;
const page = () =>
  mount(PartsPage, { global: { stubs: { PartDrawer: true, LocationsDrawer: true } } });

const clearButtons = (w: ReturnType<typeof page>) =>
  w.findAll("button").filter((b) => (b.attributes("aria-label") ?? "").startsWith("Clear "));

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockClear();
  query.value = {};
  catalogue.value = { parts: [part()], total: 1 };
  low.value = { lines: [line()], total: 1 };
});

describe("the stock filter", () => {
  it("opens with nothing applied — no ✕ to clear a filter nobody set", () => {
    const w = page();
    expect(clearButtons(w)).toHaveLength(0);
    expect(w.text()).toContain("1 part");
  });

  it("reads the home's ?stock=low as the low-stock view, which is a filter in force", () => {
    query.value = { stock: "low" };
    const w = page();
    expect(clearButtons(w)).toHaveLength(1);
    expect(w.text()).toContain("1 shelf");
    expect(w.text()).toContain("Main shelf");
  });
});

describe("the header", () => {
  it("names what its buttons open, rather than showing an unlabelled gear", () => {
    const text = page().text();
    expect(text).toContain("Stock locations");
    expect(text).toContain("New part");
  });
});

describe("opening a row", () => {
  it("gives every row a menu, so a keyboard can reach what a click can", async () => {
    const w = page();
    // The menu's items render only once it is open; the trigger is what proves the path exists.
    expect(w.find('button[aria-label="Actions"]').exists()).toBe(true);
    const table = w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } };
    table.vm.$emit("row-click", part());
    await w.vm.$nextTick();
    expect(push).toHaveBeenCalledWith({ name: "part", params: { id: "p1" } });
  });
});
