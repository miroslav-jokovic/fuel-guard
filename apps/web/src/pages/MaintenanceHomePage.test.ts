import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { StockLineDto, UnitKitDto } from "@silvicom/shared";

/**
 * The shop's home (INVENTORY-PLAN.md I4; reshaped 2026-09-10).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **A tile that goes nowhere.** The shortfall tile is the link `UnitsPage.vue` reads as
 *      `?kit=short`; a home that counted short units and did not link them would be a number with
 *      no walk behind it. The tile was withheld "until I7–I9" for a while after both had shipped.
 *   2. **A preview that pretends to be the whole answer.** The reorder and shortfall lists are the
 *      HEAD of complete endpoints; past the preview the page must say how many more there are, or
 *      "eight to order" gets believed about a shop with forty.
 *   3. **First run is a callout, not a wall of zeros.** With nothing in the catalogue there is
 *      nothing to count, and four tiles reading 0 would say the shop is fine.
 */

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

const unit = (over: Partial<UnitKitDto> = {}): UnitKitDto => ({
  kind: "tractor",
  unitId: "u1",
  unitNumber: "611",
  inferredDriverName: null,
  state: "short",
  shortBy: 2,
  extraBy: 0,
  lines: [],
  ...over,
});

const low = ref<{ lines: StockLineDto[]; total: number }>({ lines: [], total: 0 });
const short = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
const catalogue = ref<{ parts: unknown[]; total: number }>({ parts: [], total: 1 });

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    useLowStockQuery: () => ({ data: low, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
    useMovementsQuery: () => ({ data: r({ movements: [], total: 7 }), isLoading: r(false) }),
    usePartsQuery: () => ({ data: catalogue, isLoading: r(false) }),
    useLocationsQuery: () => ({ data: r([]) }),
    useOpenCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitsQuery: () => ({ data: short, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
  };
});
vi.mock("@/features/maintenance/useMaintenanceSpend", async () => {
  const { ref: r } = await import("vue");
  return {
    useMaintenanceSpendQuery: () => ({
      data: r({ entries: [], total: 0, totalAmount: 18421, pendingSources: null }),
      isLoading: r(false),
    }),
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("vue-router", async () => {
  const { h } = await import("vue");
  return {
    useRoute: () => ({ query: {}, params: {}, meta: { title: "Shop" }, matched: [], path: "/shop" }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
    // A link that renders its destination, so a test can read where a tile goes.
    RouterLink: {
      props: ["to"],
      setup(props: { to: unknown }, { slots }: { slots: { default?: () => unknown } }) {
        return () => h("a", { href: typeof props.to === "string" ? props.to : JSON.stringify(props.to) }, slots.default?.() as never);
      },
    },
  };
});

const HomePage = (await import("@/pages/MaintenanceHomePage.vue")).default;
const page = () =>
  mount(HomePage, { global: { stubs: { SlideOver: true, StartCountDrawer: true } } });

beforeEach(() => {
  setActivePinia(createPinia());
  low.value = { lines: [], total: 0 };
  short.value = { units: [], total: 0 };
  catalogue.value = { parts: [], total: 1 };
});

describe("the tiles", () => {
  it("counts the units short of their kit and links the tile to the Units page's own filter", () => {
    short.value = { units: [unit(), unit({ unitId: "u2", unitNumber: "720", shortBy: 1 })], total: 2 };
    const w = page();
    expect(w.text()).toContain("Short of kit");
    expect(w.html()).toContain("/shop/units?kit=short");
  });

  it("says every unit has its kit when none is short, rather than a bare zero", () => {
    expect(page().text()).toContain("Every unit has its kit");
  });
});

describe("the lists under the tiles", () => {
  it("previews what to order, with the part and how many to buy", () => {
    low.value = { lines: [line(), line({ partId: "p2", partNumber: "FS19732", reorderQuantity: 12 })], total: 2 };
    const text = page().text();
    expect(text).toContain("To order");
    expect(text).toContain("LF9009");
    expect(text).toContain("12");
    expect(text).not.toContain("All 2 shelves");
  });

  it("says how many more there are once the preview stops short of the whole list", () => {
    low.value = {
      lines: Array.from({ length: 12 }, (_, i) => line({ partId: `p${i}`, partNumber: `P-${i}` })),
      total: 12,
    };
    const w = page();
    expect(w.text()).toContain("All 12 shelves");
    // Eight rows on the home; the ninth is on the page the link opens.
    expect(w.text()).toContain("P-7");
    expect(w.text()).not.toContain("P-8");
  });

  it("previews the short units by number and shortfall", () => {
    short.value = { units: [unit({ unitNumber: "R-1202", shortBy: 3 })], total: 1 };
    const text = page().text();
    expect(text).toContain("R-1202");
    expect(text).toContain("3");
  });
});

describe("first run", () => {
  it("is one callout with the first thing to do, and no tiles", () => {
    catalogue.value = { parts: [], total: 0 };
    const w = page();
    expect(w.text()).toContain("No parts on the shelves yet");
    expect(w.text()).toContain("Add a part");
    expect(w.text()).not.toContain("Low stock");
  });
});
