import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AnnualDueDto, ShopDefectDto, ShopWorkOrderDto, StockLineDto, UnitKitDto } from "@silvicom/shared";

/**
 * The shop's home as one worklist (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.2, M2, D-MX2).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **A heading over nothing.** D-MX2's rule is no counter without its list — and its corollary,
 *      no group without rows. Six headings over six empty tables is the page this replaced.
 *   2. **A quiet day claimed too early.** "Nothing waits on the shop" must be true of every read
 *      that has ANSWERED; said over a read still in flight, or one that failed, it turns a 500 into
 *      "nothing due" (D-US9).
 *   3. **A preview that pretends to be the whole answer.** Each group is the head of a whole list,
 *      and "All N" beside it carries the whole list's count, or five defects get believed about a
 *      shop with forty.
 *   4. **A door the reader cannot go through.** Every "All N" and every row asks whether its page
 *      opens for this reader (SP5); a link the guard bounces is worse than none.
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
const defect = (over: Partial<ShopDefectDto> = {}): ShopDefectDto => ({
  id: "d1",
  unitNumber: "654",
  name: "Brake hose chafed",
  description: null,
  driverComment: null,
  detectedAt: "2026-10-01T12:00:00+00:00",
  ...over,
} as ShopDefectDto);
const order = (over: Partial<ShopWorkOrderDto> = {}): ShopWorkOrderDto => ({
  id: "w1",
  referenceNumber: "WO-1001",
  unitNumber: "720",
  description: "Replace steer tires",
  priority: "HIGH",
  openedAt: "2026-10-03T12:00:00+00:00",
  ...over,
} as ShopWorkOrderDto);
const due = (over: Partial<AnnualDueDto> = {}): AnnualDueDto => ({
  subjectType: "tractor",
  unitId: "v-654",
  unitNumber: "654",
  expiresOn: "2026-11-05",
  daysRemaining: 10,
  ...over,
});

const low = ref<{ lines: StockLineDto[]; total: number }>({ lines: [], total: 0 });
const short = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
const defects = ref<ShopDefectDto[]>([]);
const orders = ref<ShopWorkOrderDto[]>([]);
const annual = ref<AnnualDueDto[]>([]);
const openWalks = ref<{ sessions: unknown[]; total: number }>({ sessions: [], total: 0 });

/** Reads that answer 500, reads still in flight, and each read's Retry. */
const failing = new Set<string>();
const loading = new Set<string>();
const retried: string[] = [];
const read = (name: string, data: unknown) => {
  const fails = failing.has(name);
  return {
    data: fails || loading.has(name) ? ref(undefined) : data,
    isLoading: ref(loading.has(name)),
    isError: ref(fails),
    isFetching: ref(false),
    refetch: () => retried.push(name),
  };
};
let queries: Record<"low" | "short" | "defects" | "orders" | "annual" | "walks" | "spend", ReturnType<typeof read>>;
function buildQueries() {
  queries = {
    low: read("low", low),
    short: read("short", short),
    defects: read("defects", defects),
    orders: read("orders", orders),
    annual: read("annual", annual),
    walks: read("walks", openWalks),
    spend: read("spend", ref({ entries: [], total: 0, totalAmount: 18421, pendingSources: null })),
  };
}

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    INVENTORY_PAGE_SIZE: 50,
    useLowStockQuery: () => queries.low,
    useLocationsQuery: () => ({ data: r([]) }),
    useOpenCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    // R9: the open walks — read by the page for the quiet-day sentence and by `OpenCountsList`.
    useCountSessionsQuery: () => queries.walks,
    useCloseCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
/** The filter the page handed `useUnitsQuery` — the group's question (R10). */
let unitsFilter: { value: Record<string, unknown> } | null = null;
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitsQuery: (f: { value: Record<string, unknown> }) => {
    unitsFilter = f;
    return queries.short;
  },
}));
vi.mock("@/features/maintenance/useMaintenanceSpend", () => ({ useMaintenanceSpendQuery: () => queries.spend }));
vi.mock("@/features/maintenance/useShopBacklog", () => ({
  useUnresolvedDefectsQuery: () => queries.defects,
  useOpenWorkOrdersQuery: () => queries.orders,
  useAnnualDueQuery: () => queries.annual,
}));
/** The roadside repairs (IC11 B2b); read only when their page opens. */
const repairsDue = ref<import("@silvicom/shared").RoadsideRepairDueDto[] | undefined>([]);
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
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("technician");
  return { useSessionStore: () => s, __session: s };
});
vi.mock("vue-router", async (importOriginal) => {
  const { h } = await import("vue");
  return {
    ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
      await importOriginal<typeof import("vue-router")>(),
    ),
    useRoute: () => ({ query: {}, params: {}, meta: { title: "Shop" }, matched: [], path: "/shop" }),
    useRouter: () => ({ push: (to: unknown) => pushed.push(to), replace: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
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
const page = () => mount(HomePage, { global: { stubs: { SlideOver: true, StartCountDrawer: true } } });
const headings = (w: ReturnType<typeof page>) => w.findAll("h2").map((h) => h.text());
const section = (w: ReturnType<typeof page>, id: string) => w.find(`[data-test="${id}"]`);

beforeEach(() => {
  setActivePinia(createPinia());
  session.role = "technician";
  session.surfaces = null;
  low.value = { lines: [], total: 0 };
  short.value = { units: [], total: 0 };
  defects.value = [];
  orders.value = [];
  annual.value = [];
  openWalks.value = { sessions: [], total: 0 };
  failing.clear();
  loading.clear();
  retried.length = 0;
  repairsDue.value = [];
  repairsAsked.length = 0;
  pushed.length = 0;
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  buildQueries();
});

describe("a quiet day", () => {
  it("draws no group and says so once, with the two verbs still there", () => {
    const w = page();
    expect(headings(w)).toEqual([]);
    expect(section(w, "quiet-day").text()).toContain("Nothing waits on the shop today");
    const labels = w.findAll("button").map((b) => b.text());
    expect(labels.filter((l) => l === "Scan")).toHaveLength(2); // the header row and the phone's bar
    expect(labels).toContain("Count a shelf");
  });

  it("is not claimed while a read is still in flight, nor when one has failed", () => {
    loading.add("annual");
    buildQueries();
    expect(section(page(), "quiet-day").exists()).toBe(false);
    loading.clear();
    failing.add("defects");
    buildQueries();
    const w = page();
    expect(section(w, "quiet-day").exists()).toBe(false);
    expect(section(w, "defects").text()).toContain("Could not load the open defects.");
  });

  it("is not claimed while a check is left open, which the list below still shows", () => {
    openWalks.value = { sessions: [], total: 1 };
    buildQueries();
    expect(section(page(), "quiet-day").exists()).toBe(false);
  });
});

describe("the groups", () => {
  it("draws a group only when it has rows, as the head of its list with the whole count beside it", () => {
    defects.value = Array.from({ length: 7 }, (_, i) => defect({ id: `d${i}`, unitNumber: `65${i}` }));
    const w = page();
    expect(headings(w)).toEqual(["Found on an inspection, not fixed"]);
    const group = section(w, "defects");
    expect(group.findAll("tbody tr")).toHaveLength(5);
    expect(group.text()).toContain("Brake hose chafed");
    // `RouterLink` is unresolved under this mock, so the destination is read off the element.
    expect(group.html()).toContain('to="/shop/defects"');
    expect(group.text()).toContain("All 7 open defects");
    expect(section(w, "quiet-day").exists()).toBe(false);
  });

  it("orders the groups by how hard the deadline is", () => {
    defects.value = [defect()];
    orders.value = [order()];
    annual.value = [due()];
    short.value = { units: [unit()], total: 1 };
    low.value = { lines: [line()], total: 1 };
    expect(headings(page())).toEqual([
      "Found on an inspection, not fixed",
      "In the shop now",
      "Annual inspection due",
      "Missing equipment",
      "Running low",
    ]);
  });

  it("says how many days an annual inspection has left or is overdue, and opens the inspections list on the unit", async () => {
    annual.value = [
      due({ unitId: "v-1", unitNumber: "701", expiresOn: "2026-10-20", daysRemaining: -6 }),
      due({ unitId: "v-2", unitNumber: "700", expiresOn: "2026-11-09", daysRemaining: 14 }),
    ];
    const w = page();
    const when = w.findAll('[data-test="annual-due-when"]').map((s) => s.text());
    expect(when).toEqual(["10/20/2026 · 6 days overdue", "11/09/2026 · 14 days left"]);
    expect(section(w, "annual-due").text()).toContain("Truck");
    await section(w, "annual-due").find("tbody tr").trigger("click");
    expect(pushed).toEqual([{ path: "/shop/inspections", query: { search: "701" } }]);
  });

  it("asks only about checked trucks and trailers for the missing-equipment group (R10)", () => {
    page();
    expect(unitsFilter!.value).toEqual({ shortOnly: true, checkedOnly: true });
  });

  it("previews the shelves running low with the part, what is on hand and how many to order", () => {
    low.value = { lines: [line({ reorderQuantity: 24 })], total: 1 };
    const w = page();
    expect(section(w, "running-low").text()).toContain("LF9009");
    expect(section(w, "running-low").text()).toContain("Oil filter");
    expect(section(w, "running-low").text()).toContain("24");
  });
});

describe("doors that open only where their page does (SP5)", () => {
  it("keeps the missing-equipment rows but drops their link and their click when Trucks & trailers is off", async () => {
    short.value = { units: [unit()], total: 1 };
    expect(page().html()).toContain("/shop/units?show=short");
    session.surfaces = { "maintenance.units": false };
    const w = page();
    expect(section(w, "missing-equipment").text()).toContain("611");
    expect(w.html()).not.toContain("/shop/units?show=short");
    await section(w, "missing-equipment").find("tbody tr").trigger("click");
    expect(pushed).toEqual([]);
  });

  it("drops Count a shelf and the running-low link when Parts is off for this person", () => {
    low.value = { lines: [line()], total: 1 };
    session.surfaces = { "maintenance.parts": false };
    const w = page();
    expect(w.findAll("button").map((b) => b.text())).not.toContain("Count a shelf");
    expect(w.html()).not.toContain("/shop/inventory?stock=low");
  });

  it("goes to the scanner from Scan", async () => {
    const w = page();
    await w.findAll("button").find((b) => b.text() === "Scan")!.trigger("click");
    expect(pushed).toEqual(["/shop/scan"]);
  });
});

describe("a failed read", () => {
  it("draws the group as a failure with Retry, and Retry asks that read again", async () => {
    failing.add("orders");
    buildQueries();
    const w = page();
    expect(section(w, "work-orders").text()).toContain("Could not load the open work orders.");
    await section(w, "work-orders").findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    await flushPromises();
    expect(retried).toEqual(["orders"]);
  });
});

describe("roadside repairs due", () => {
  it("is asked only when its page opens for this person, and not drawn when nothing is open", () => {
    const w = page();
    expect(repairsAsked.at(-1)!.value).toBe(true);
    expect(section(w, "roadside-repairs-due").exists()).toBe(false);
    // The page answers to the shop home's key (D-SURF8, `parent`), as the work-order and defect lists do.
    session.surfaces = { "maintenance.repair-spend": false };
    page();
    expect(repairsAsked.at(-1)!.value).toBe(false);
  });
});

describe("the one figure", () => {
  it("shows the repair bills behind their page", () => {
    const w = page();
    expect(w.text()).toContain("Repair bills");
    expect(w.text()).toContain("18,421");
    expect(w.html()).toContain("/shop/repair-spend");
  });
});
