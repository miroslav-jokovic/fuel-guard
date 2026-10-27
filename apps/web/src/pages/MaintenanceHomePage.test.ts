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
  lastCheckedAt: null,
  lines: [],
  ...over,
});

const low = ref<{ lines: StockLineDto[]; total: number }>({ lines: [], total: 0 });
const short = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
const catalogue = ref<{ parts: unknown[]; total: number }>({ parts: [], total: 1 });
const openWalks = ref<{ sessions: unknown[]; total: number }>({ sessions: [], total: 0 });

/**
 * F1 (US6b): the reads that answer 500, and each read's Retry. The page's tiles and its first-run
 * callout used to fall back to zero on a failed read.
 */
const failing = new Set<string>();
const retried: string[] = [];
const read = (name: string, data: unknown) => {
  const fails = failing.has(name);
  return {
    data: fails ? ref(undefined) : data,
    isLoading: ref(false),
    isError: ref(fails),
    isFetching: ref(false),
    refetch: () => retried.push(name),
  };
};
/** The page's reads, rebuilt per test from `failing` — the mocks below hand these out. */
let queries: Record<"low" | "short" | "today" | "parts" | "spend" | "summary", ReturnType<typeof read>>;
function buildQueries() {
  queries = {
    low: read("low", low),
    short: read("short", short),
    today: read("today", ref({ movements: [], total: 7 })),
    parts: read("parts", catalogue),
    spend: read("spend", ref({ entries: [], total: 0, totalAmount: 18421, pendingSources: null })),
    summary: read("summary", summary),
  };
}

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    useLowStockQuery: () => queries.low,
    useMovementsQuery: () => queries.today,
    usePartsQuery: () => queries.parts,
    useLocationsQuery: () => ({ data: r([]) }),
    useOpenCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    // R9: the open walks, which `OpenCountsList` reads; `OpenCountsList.test.ts` drives it.
    useCountSessionsQuery: () => ({ data: openWalks, isError: r(false), isFetching: r(false), refetch: vi.fn() }),
    useCloseCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
/** The filter the page last handed `useUnitsQuery` — the tile's question (R10). */
let unitsFilter: { value: Record<string, unknown> } | null = null;
vi.mock("@/features/inventory/useUnits", () => {
  return {
    useUnitsQuery: (f: { value: Record<string, unknown> }) => {
      unitsFilter = f;
      return queries.short;
    },
  };
});
vi.mock("@/features/maintenance/useMaintenanceSpend", () => {
  return {
    useMaintenanceSpendQuery: () => queries.spend,
  };
});
const summary = ref({ openWorkOrders: 24, oldestOpenWorkOrderAt: "2026-06-24T15:12:00+00:00", unresolvedDefects: 52, lowStockLines: 0 });
vi.mock("@/features/maintenance/useShopBacklog", () => {
  return { useShopSummaryQuery: () => queries.summary };
});
/** The roadside repairs the Shop home previews (IC11 B2b); the section reads them only when its page opens. */
const repairsDue = ref<import("@silvicom/shared").RoadsideRepairDueDto[] | undefined>([]);
/** The `enabled` each mount handed the query, newest last. */
const repairsAsked: import("vue").Ref<boolean>[] = [];
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r } = await import("vue");
  return {
    useRoadsideRepairsDueQuery: (enabled: import("vue").Ref<boolean>) => {
      repairsAsked.push(enabled);
      return { data: repairsDue, isLoading: r(false), isError: r(false), isFetching: r(false), refetch: vi.fn() };
    },
  };
});
vi.mock("@/composables/useOrgTimezone", async () => {
  const { ref: r } = await import("vue");
  return { useOrgTimezone: () => ({ zone: r("America/Chicago") }) };
});
const pushed: unknown[] = [];
// The desktop table: jsdom has no `matchMedia`, and DataTable would otherwise draw its narrow cards.
vi.mock("@vueuse/core", async (orig) => {
  const { ref: r } = await import("vue");
  return { ...((await orig()) as Record<string, unknown>), useMediaQuery: () => r(true) };
});
// The real shape (SP5): every door on the page now asks the guard's function, which reads the role
// and the screen answers. A technician holds `maintenance: manage` as shipped.
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("technician");
  return { useSessionStore: () => s, __session: s };
});
vi.mock("vue-router", async (importOriginal) => {
  const { h } = await import("vue");
  return {
    // SP5: `useOpens()` resolves links against the route table with the REAL router factory, so the
    // three names it takes from vue-router stay real under this mock.
    ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
      await importOriginal<typeof import("vue-router")>(),
    ),
    useRoute: () => ({ query: {}, params: {}, meta: { title: "Shop" }, matched: [], path: "/shop" }),
    useRouter: () => ({ push: (to: unknown) => pushed.push(to), replace: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
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
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};
const page = () =>
  mount(HomePage, { global: { stubs: { SlideOver: true, StartCountDrawer: true } } });

beforeEach(() => {
  setActivePinia(createPinia());
  session.role = "technician";
  session.surfaces = null;
  low.value = { lines: [], total: 0 };
  short.value = { units: [], total: 0 };
  catalogue.value = { parts: [], total: 1 };
  openWalks.value = { sessions: [], total: 0 };
  failing.clear();
  retried.length = 0;
  repairsDue.value = [];
  repairsAsked.length = 0;
  pushed.length = 0;
  buildQueries();
});

describe("the tiles", () => {
  it("counts the units short of their kit and links the tile to the Units page's own filter", () => {
    short.value = { units: [unit(), unit({ unitId: "u2", unitNumber: "720", shortBy: 1 })], total: 2 };
    const w = page();
    expect(w.text()).toContain("Short of kit");
    expect(w.html()).toContain("/shop/units?kit=short-checked");
  });

  /**
   * R10: adopting the standard kit makes every unit short on paper until its things are tagged. The
   * tile asks only about units somebody has checked, says so, and links to that same list.
   */
  it("counts only units somebody has checked, and says so", () => {
    short.value = { units: [unit()], total: 1 };
    const w = page();
    expect(unitsFilter!.value).toEqual({ shortOnly: true, checkedOnly: true });
    expect(w.text()).toContain("Checked units missing something");
  });

  it("says no checked unit is missing anything when none is short, rather than a bare zero", () => {
    expect(page().text()).toContain("No checked unit is missing anything");
  });
});

/**
 * FleetPal's repair backlog (FLEET-MANAGER-HOME-PLAN Q-FM6 (a)): the same counts as the Operations
 * tab's Shop card, each a door to its list — and present on first run too, because an org with no
 * parts entered still has trucks in the shop.
 */
describe("the repair tiles", () => {
  it("counts open work orders and open defects, each a door to its list", () => {
    const w = page();
    expect(w.text()).toContain("Open work orders");
    expect(w.text()).toContain("24");
    expect(w.text()).toContain("52");
    expect(w.html()).toContain("/shop/work-orders");
    expect(w.html()).toContain("/shop/defects");
  });

  it("stays when the shelves are empty, beside the first-run callout", () => {
    catalogue.value = { parts: [], total: 0 };
    const w = page();
    expect(w.text()).toContain("No parts on the shelves yet");
    expect(w.text()).toContain("Open defects");
  });

  it("drops a door, not the figure, when the shop is off for this person (D-SURF8: the lists answer to it)", () => {
    session.surfaces = { "maintenance.repair-spend": false };
    const w = page();
    expect(w.text()).toContain("Open work orders");
    expect(w.html()).not.toContain("/shop/work-orders");
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
  it("is one callout with the first thing to do, and no inventory tiles", () => {
    catalogue.value = { parts: [], total: 0 };
    const w = page();
    expect(w.text()).toContain("No parts on the shelves yet");
    expect(w.text()).toContain("Add a part");
    expect(w.text()).not.toContain("Low stock");
  });
});

/**
 * SP5 (plan §4b): every door on the home asks whether its page opens for the reader. Parts and Units
 * are each a screen the admin can switch off for one person (D-SURF1); the figure stays, the door goes.
 */
describe("doors that open only where their page does (SP5)", () => {
  it("drops the Units door from the tile, the list and its rows when Units is off for this person", () => {
    short.value = {
      units: Array.from({ length: 12 }, (_, i) => unit({ unitId: `u${i}`, unitNumber: `7${i}` })),
      total: 12,
    };
    expect(page().html()).toContain("/shop/units?kit=short");
    session.surfaces = { "maintenance.units": false };
    const w = page();
    expect(w.text()).toContain("Short of kit");
    expect(w.html()).not.toContain("/shop/units?kit=short");
    expect(w.text()).not.toContain("All 12 units");
  });

  it("drops Add a part when Parts is off for this person", () => {
    catalogue.value = { parts: [], total: 0 };
    expect(page().text()).toContain("Add a part");
    session.surfaces = { "maintenance.parts": false };
    expect(page().text()).not.toContain("Add a part");
  });
});

/**
 * F1 (US6b): a failed read is not an empty shop. Before, a failed summary read said "0" open work
 * orders and defects, and a failed parts read "No parts on the shelves yet. Add the first part".
 */
describe("a failed read", () => {
  const retry = async (w: ReturnType<typeof page>, n = 0) => {
    await w.findAll("button").filter((b) => b.text() === "Retry")[n]!.trigger("click");
  };

  it("draws the repair tiles as failures, not zeros, and Retry asks FleetPal's summary again", async () => {
    failing.add("summary");
    buildQueries();
    const w = page();
    expect(w.text()).toContain("Could not load the work orders.");
    expect(w.text()).toContain("Could not load the defects.");
    expect(w.text()).not.toMatch(/Open work orders\s*0/);
    await retry(w);
    expect(retried).toEqual(["summary"]);
  });

  it("does not call a shop whose parts could not be read empty", async () => {
    failing.add("parts");
    buildQueries();
    const w = page();
    expect(w.text()).toContain("Could not load the parts.");
    expect(w.text()).not.toContain("No parts on the shelves yet");
    await retry(w);
    expect(retried).toEqual(["parts"]);
  });

  it("draws today's movements and the repair spend as failures, not zero and $0", async () => {
    failing.add("today");
    failing.add("spend");
    buildQueries();
    const t = page().text();
    expect(t).toContain("Could not load what moved today.");
    expect(t).toContain("Could not load the repair spend.");
    expect(t).not.toContain("$0");
  });
});

/**
 * Roadside repairs due (IC11 B2b, Q-IC16 (a)): the technician's door to the 396.9(d) repair record, which the
 * safety-gated inspection page is not.
 */
describe("roadside repairs due", () => {
  const due = (unitId: string, dueOn: string, o: Partial<import("@silvicom/shared").RoadsideRepairDueDto> = {}): import("@silvicom/shared").RoadsideRepairDueDto => ({
    unitId, unit: { seq: 1, kind: "tractor", companyNumber: unitId.toUpperCase() }, violations: [], dueOn,
    proposal: { outcome: "no_candidate", candidates: [], readAt: "x" }, decision: null, basedOn: "r",
    inspection: { id: `i-${unitId}`, reportNumber: null, reportState: "IL", inspectionDate: "2026-10-01", locationDesc: null },
    ...o,
  });

  it("previews the open repairs nearest to today, never a recorded one, and opens the page at the row's inspection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T17:00:00Z"));
    repairsDue.value = [
      due("old", "2026-03-01"),
      due("soon", "2026-10-21"),
      due("done", "2026-10-20", { decision: { outcome: "accepted", workOrder: null, note: null, decidedBy: "Pat", decidedAt: "x" } }),
    ];
    const w = page();
    const rows = w.findAll("[data-test='roadside-repairs-due'] tbody tr").map((r) => r.text());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("SOON");
    expect(rows[0]).toContain("10/21/2026 · 2 days left");
    expect(rows[1]).toContain("days overdue");
    await w.findAll("[data-test='roadside-repairs-due'] tbody tr")[0]!.trigger("click");
    expect(pushed).toEqual([{ path: "/shop/roadside-repairs", query: { inspection: "i-soon" } }]);
    vi.useRealTimers();
  });

  it("is not drawn, nor read, when its page is off for this person", () => {
    // The page answers to the shop home's key (D-SURF8, `parent`), as the work-order and defect lists do.
    session.surfaces = { "maintenance.repair-spend": false };
    expect(page().find("[data-test='roadside-repairs-due']").exists()).toBe(false);
    expect(repairsAsked.at(-1)!.value).toBe(false);
  });
});

/** R9: walks somebody started and nobody closed — drawn only when there are some. */
describe("open counts", () => {
  it("lists the open walks under their own heading", () => {
    openWalks.value = {
      sessions: [
        {
          id: "s1", kind: "unit", locationId: null, vehicleId: "v1", trailerId: null, holderLabel: "654",
          startedBy: null, startedByName: "Shop Lead", blind: false, status: "open",
          openedAt: "2026-10-19T14:00:00.000Z", closedAt: null, note: null,
        },
      ],
      total: 1,
    };
    const text = page().text();
    expect(text).toContain("Open counts");
    expect(text).toContain("Kit check — 654");
  });

  it("draws nothing when nothing is open", () => {
    expect(page().text()).not.toContain("Open counts");
  });
});
