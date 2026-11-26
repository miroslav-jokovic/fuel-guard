import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import type { DispatchBoardResponse, DispatchBoardRow, DriverOverviewRow } from "@silvicom/shared";

/**
 * The Operations tab (FLEET-MANAGER-HOME-PLAN FM1/FM2), rendered through the real catalogue renderer
 * with every data source answered here. What it holds:
 *
 *   · the cards a caller gets follow each card's SECTION gate, not the tab's (D-FM4);
 *   · no currency figure anywhere on the tab, for anyone (D-FM6);
 *   · every count is the row count of the list its door opens (D-FM7/D-FM9) — asserted as the
 *     number on the card against the fixture counted by the same rule the list uses.
 *
 * It lives in `lib/` beside the registry because it reaches into six features' cards, which only the
 * composition root may name (`lint:boundaries`).
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("fleet_manager");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};

const modules = ref(new Set(["dispatch", "navigation", "hazmatguard"]));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => ({ data: modules }) }));
vi.mock("@/composables/useDashboardLayout", () => ({
  useDashboardLayout: () => ({ layout: computed(() => null), loading: computed(() => false), saving: computed(() => false), save: async () => {}, reset: async () => {} }),
}));
vi.mock("@/composables/useOrgTimezone", () => ({
  useOrgTimezone: () => ({ zone: computed(() => "America/Chicago"), isResolved: computed(() => true) }),
}));

// ── the board ───────────────────────────────────────────────────────────────────────────────────
const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, warningUrgent: false, homeTimeUrgent: false };
const load = { loadId: "l", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P", customerName: "Viking Packing",
  dispatcherId: null, driverName: null, trailerUnit: null, nextStop: null, lastStop: null, stopsLeft: 1 };
const boardRow = (unitNumber: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, coDriver: null, trailerId: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", available: null, milesLeft: null, warnings: [], noteMentions: [], homeTimes: [], flags, ...o,
});
const BOARD: DispatchBoardResponse = {
  generatedAt: "2026-10-12T15:00:00.000Z",
  rows: [
    boardRow("773", { current: load, flags: { ...flags, noNextLoad: true } }),
    boardRow("801", { current: load, flags: { ...flags, lateRisk: true, hosLow: true } }),
    boardRow("698", { flags: { ...flags, emptyNow: true, noGps: true } }),
    boardRow("660", { inShop: true }),
    boardRow("550", { fleetCode: "1", flags: { ...flags, lateRisk: true, emptyNow: true } }), // parked pool
  ],
  scope: { linked: false, fleetCodes: [], dispatcherIds: [] },
  fleets: [], dispatchers: [], uncoveredCount: 3, hosAsOf: null,
};
vi.mock("@/features/dispatch/useDispatchBoard", () => ({ useDispatchBoardQuery: () => ({ data: ref(BOARD) }) }));

// ── driver files ────────────────────────────────────────────────────────────────────────────────
const dq = (id: string, o: Partial<DriverOverviewRow>): DriverOverviewRow => ({
  driver_id: id, driver_name: `Driver ${id}`, driver_status: "active", state: "complete",
  counts: { current: 5, expiring: 0, expired: 0, missing: 0 }, groups: [], attention: [], requirements: [],
  documents: { withScan: 0, total: 0 } as unknown as DriverOverviewRow["documents"], ...o,
});
const OVERVIEW = [
  // Two expired ITEMS on one driver: the card counts one DRIVER, because its door lists drivers.
  dq("a", { state: "incomplete", counts: { current: 3, expiring: 0, expired: 2, missing: 0 },
    attention: [{ label: "Medical card", daysRemaining: -4, goodUntil: "2026-10-08" }] as unknown as DriverOverviewRow["attention"] }),
  dq("b", { state: "incomplete", counts: { current: 4, expiring: 1, expired: 0, missing: 0 },
    attention: [{ label: "CDL", daysRemaining: 12, goodUntil: "2026-10-24" }] as unknown as DriverOverviewRow["attention"] }),
  dq("c", { state: "not_started", counts: { current: 0, expiring: 0, expired: 0, missing: 6 } }),
  dq("d", {}),
];
/**
 * Each truck's file as `/api/compliance/unit-files` serves it (UNIT-FILES-PLAN UF4), built from the
 * trucks below. No paper is filed except t2's registration, so every other answer is McLeod's date as
 * the file's `dateOnly` — which is how the card's counts stay what they were before UF4 — and t2's
 * filed registration outranks McLeod's lapsed one (D-UF3).
 */
type Item = { key: string; state: string; goodUntil: string | null; dateOnly: { goodUntil: string; state: string } | null };
const dated = (key: string, day: string | null, state: string): Item => ({ key, state: "missing", goodUntil: null, dateOnly: day ? { goodUntil: day, state } : null });
const UNIT_FILES = [
  { subject_id: "t1", items: [dated("annual_inspection", "2026-10-01", "expired"), dated("registration", "2027-01-01", "current")] },
  { subject_id: "t2", items: [dated("annual_inspection", "2026-10-30", "expiring"), { key: "registration", state: "current", goodUntil: "2027-09-30", dateOnly: null }] },
  { subject_id: "t3", items: [dated("annual_inspection", null, ""), dated("registration", null, "")] },
  { subject_id: "t5", items: [dated("annual_inspection", "2020-01-01", "expired"), dated("registration", null, "")] },
  { subject_id: "t6", items: [dated("annual_inspection", "2027-06-01", "current"), dated("registration", "2027-06-01", "current")] },
];
vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: ref({ drivers: OVERVIEW, includesHazmat: false, truncated: false }) }),
  useUnitFilesQuery: () => ({ data: ref({ units: UNIT_FILES }) }),
}));

// ── trucks and drivers ──────────────────────────────────────────────────────────────────────────
const VEHICLES = [
  { id: "t1", status: "active", assigned_driver_id: "a", dot_annual_inspection_expires_at: "2026-10-01", registration_expires_at: "2027-01-01" },
  { id: "t2", status: "active", assigned_driver_id: null, dot_annual_inspection_expires_at: "2026-10-30", registration_expires_at: "2026-09-30" },
  { id: "t3", status: "active", assigned_driver_id: null, dot_annual_inspection_expires_at: null, registration_expires_at: null },
  { id: "t4", status: "ordered", assigned_driver_id: null, dot_annual_inspection_expires_at: null, registration_expires_at: null },
  { id: "t5", status: "retired", assigned_driver_id: "b", dot_annual_inspection_expires_at: "2020-01-01", registration_expires_at: null },
  // Sold and awaiting pickup (McLeod `tractor_status = 'I'`, D-DB11): still `active`, never to be seated.
  { id: "t6", status: "active", winding_down: true, assigned_driver_id: null, dot_annual_inspection_expires_at: "2027-06-01", registration_expires_at: "2027-06-01" },
  // Parked in McLeod's fleet '1', the Unassigned pool the board leaves out (Q-DB2, D-FM10): no empty seat.
  { id: "t7", status: "active", mcleod_fleet_code: "1", assigned_driver_id: null, dot_annual_inspection_expires_at: null, registration_expires_at: null },
  // In the shop and on the board: the board's "In the shop", and an empty seat when nobody holds it.
  { id: "t8", status: "maintenance", mcleod_fleet_code: "VINNIEV", assigned_driver_id: null, dot_annual_inspection_expires_at: null, registration_expires_at: null },
];
const DRIVERS = [
  { id: "a", status: "active", archived_at: null },
  { id: "b", status: "active", archived_at: null }, // only on a retired truck — holds nothing
  { id: "c", status: "active", archived_at: null },
  { id: "x", status: "terminated", archived_at: null },
];
const vehicles = ref<typeof VEHICLES | undefined>(VEHICLES);
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: vehicles }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref(DRIVERS) }) }));

// ── the shop ────────────────────────────────────────────────────────────────────────────────────
// Opened 2026-06-24 at 15:12 UTC = 10:12 Chicago; "today" below is 2026-10-12 in Chicago → 110 days.
const SHOP = { openWorkOrders: 24, oldestOpenWorkOrderAt: "2026-06-24T15:12:00+00:00", unresolvedDefects: 52, lowStockLines: 3 };
const shop = ref<typeof SHOP>(SHOP);
vi.mock("@/features/maintenance/useShopBacklog", () => ({ useShopSummaryQuery: () => ({ data: shop }) }));

// ── roadside ────────────────────────────────────────────────────────────────────────────────────
// Production's 30 days 09-20..10-19 (2026-10-19): 32 inspections, 19 clean; 4 of 23 vehicle and 1 of 32 driver inspections OOS.
const FEED = { fetchedAt: "2026-10-13T14:17:00Z", sourceUpdatedAt: "2026-10-13T03:02:00Z", state: "fresh" as "fresh" | "ours_late" | "fmcsa_late" | "never" };
const rate = (count: number, of: number) => ({ count, of, share: of ? count / of : null });
const ROADSIDE = {
  from: "2026-09-12", to: "2026-10-12", feed: FEED,
  stats: {
    inspections: 32, clean: rate(19, 32), vehicleOos: rate(4, 23), driverOos: rate(1, 32), hazmatOos: 1, points: 214, needsAction: 9,
    topCategories: [{ categoryId: 23, inspections: 6 }],
  },
};
const roadside = ref<typeof ROADSIDE | undefined>(ROADSIDE);
/** The range each mount asked the summary for — the page's, never a fixed window. */
const roadsideAsked: { from: string; to: string }[] = [];
vi.mock("@/features/roadside/useRoadsideInspections", () => ({
  useRoadsideSummaryQuery: (r: import("vue").Ref<{ from: string; to: string }>) => {
    roadsideAsked.push({ ...r.value });
    return { data: roadside, isError: ref(false) };
  },
}));

// ── hazmat, hiring, fuel ────────────────────────────────────────────────────────────────────────
vi.mock("@/features/hazmat/useHazmatReview", () => ({ useHazmatReviewCountQuery: () => ({ data: ref(2) }) }));
vi.mock("@/features/recruitment/useEmployment", async (orig) => ({
  ...(await orig<object>()),
  usePipelineQuery: () => ({
    data: ref([{ checklist: { waiting_on: "us" } }, { checklist: { waiting_on: "us" } }, { checklist: { waiting_on: "them" } }, { checklist: null }]),
  }),
}));
vi.mock("@/features/dashboard/fleetWidgetData", async (orig) => ({
  ...(await orig<object>()),
  useFleetWidgetData: () => ({
    s: computed(() => ({ openAnomalies: 7, idleHours: 412, idleCostUsd: 8_210.55, totalSpend: 128_400 })),
    mpgTotal: computed(() => ({ mpg: 7.4 })), mpgPrevious: computed(() => ({ mpg: 7.1 })),
    deltas: computed(() => ({ mpg: null })), previousLabel: computed(() => "Aug 12 – Sep 11"),
    previousPhrase: computed(() => "the previous 31 days"), rangeLabel: computed(() => "Sep 12 – Oct 12"),
  }),
}));

const RouterLink = { props: ["to"], template: `<a :href="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>` };
const TabWidgets = (await import("@/features/dashboard/TabWidgets.vue")).default;
const render = () =>
  mount(TabWidgets, {
    props: { tab: "ops", range: { from: "2026-09-12", to: "2026-10-12" } },
    global: { stubs: { RouterLink, DashboardLayoutEditor: true } },
  });
const cards = (w: ReturnType<typeof render>) => w.findAll("[data-test^='widget-']").map((c) => c.attributes("data-test"));
const n = (w: ReturnType<typeof render>, key: string) => w.get(`[data-test='count-${key}']`).text();
/** The card reads its sources' rows as each one reports, a tick after mount. */
const settled = async () => {
  const w = render();
  await flushPromises();
  return w;
};
/** A strip tile's figure: `StatCard` draws label, value, caption as three `p`s, in that order. */
const tile = (w: ReturnType<typeof render>, key: string) => w.get(`[data-test='count-${key}']`).findAll("p")[1]!.text();
/** The "Needs action" card's rows, top to bottom, as [source card's row, figure]. */
const needs = (w: ReturnType<typeof render>) =>
  w.get("[data-test='widget-ops.needs-action']").findAll("[data-test^='count-ops.']").map((c) => [c.attributes("data-test")!.slice("count-".length), c.text()]);
const hrefs = (w: ReturnType<typeof render>) => w.findAll("a").map((a) => a.attributes("href"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z")); // noon in Chicago
  session.role = "fleet_manager";
  session.sections = null;
  session.surfaces = null;
  modules.value = new Set(["dispatch", "navigation", "hazmatguard"]);
  shop.value = SHOP;
  vehicles.value = VEHICLES;
  roadside.value = ROADSIDE;
});
afterEach(() => vi.useRealTimers());

describe("the Operations tab", () => {
  it("gives a fleet manager every card, in the plan's order", () => {
    expect(cards(render())).toEqual([
      "widget-ops.fleet-now", "widget-ops.needs-action", "widget-ops.road-attention", "widget-ops.driver-files", "widget-ops.seats",
      "widget-ops.shop", "widget-ops.truck-papers", "widget-ops.fuel", "widget-ops.hazmat", "widget-ops.hiring",
      "widget-ops.roadside",
    ]);
  });

  it("shows nobody a currency figure, the fuel card included (D-FM6)", () => {
    session.role = "admin"; // holds accounting — and still sees no dollar, because no card reads one
    // What is PRINTED, not the markup: the strip's shared `StatCard` carries a "$151.9K" in a template
    // comment about its own layout, which is not a figure anybody is shown.
    expect(render().text()).not.toMatch(/\$/);
  });

  it("gates each card on its own section — the tab gate decides who gets the page, not what is on it", () => {
    // A technician an org trusts with the fleet's record: equipment yes, roster/dispatch/fuel none —
    // and the shop is theirs by role, so the Shop card comes with them.
    session.role = "technician";
    session.sections = { equipment: "manage" };
    const w = render();
    expect(cards(w)).toEqual(["widget-ops.needs-action", "widget-ops.seats", "widget-ops.shop", "widget-ops.truck-papers"]);
    // …and the Seats card drops its drivers line, which reads the roster.
    expect(w.find("[data-test='count-no-truck']").exists()).toBe(false);
  });

  it("gives the Roadside card to whoever reads safety, and to nobody else (FM5)", () => {
    // An org that grants a dispatcher the fleet's record gets them the tab — not FMCSA's record on it.
    session.role = "dispatcher";
    session.sections = { equipment: "manage" };
    expect(cards(render())).not.toContain("widget-ops.roadside");
    session.sections = { equipment: "manage", safety: "view" };
    expect(cards(render())).toContain("widget-ops.roadside");
  });

  it("drops the hazmat card for an org without the module", () => {
    modules.value = new Set(["dispatch", "navigation"]);
    expect(cards(render())).not.toContain("widget-ops.hazmat");
  });
});

describe("the fleet strip (D-SM12)", () => {
  it("leads the tab on the grid, full width, with every other card packed under it", () => {
    const w = render();
    expect(w.get("[data-test='widget-ops.fleet-now']").element.parentElement!.className).toContain("grid");
    expect(w.findAll("[data-test='packed'] > [data-test^='widget-']").map((c) => c.attributes("data-test"))).toEqual(cards(w).slice(1));
  });

  it("makes the total the door to the board and Empty the door to its queue, and leaves the parts without a list plain", () => {
    const w = render();
    const door = (key: string) => w.get(`[data-test='count-${key}']`).element.tagName === "A" ? w.get(`[data-test='count-${key}']`).attributes("href") : null;
    expect([door("total"), door("loaded"), door("empty"), door("in-shop")]).toEqual([
      "/assignments?scope=all", null, "/assignments?scope=all&queue=empty", null,
    ]);
    expect(w.get("[data-test='count-empty']").text()).toContain("Find a load");
  });
});

describe("Needs action (D-SM12)", () => {
  it("lists every alarm above zero from the reader's cards, largest first, ties in the tab's order", async () => {
    expect(needs(await settled())).toEqual([
      ["ops.shop.defects", "52"],
      ["ops.roadside.needs", "9"],
      ["ops.seats.no-driver", "3"],
      ["ops.hazmat.needs-review", "2"],
      ["ops.road-attention.late", "1"],
      ["ops.road-attention.hos-low", "1"],
      ["ops.driver-files.expired", "1"],
      ["ops.truck-papers.inspection_overdue", "1"],
      ["ops.roadside.hazmat-oos", "1"],
    ]);
  });

  it("says how many need a person and how many alarm checks are clear, and names each row's card", async () => {
    const card = (await settled()).get("[data-test='widget-ops.needs-action']").text();
    // Registration overdue is the one alarm at zero in this fixture.
    expect(card).toContain("9");
    expect(card).toContain("things need a person · 1 check is clear");
    expect(card).toContain("Shop · found on inspections, not resolved");
  });

  it("gives each row the door its own card gives it", async () => {
    const w = await settled();
    const own = (scope: string, key: string) => w.get(`[data-test='${scope}']`).findAll("li").find((li) => li.find(`[data-test='count-${key}']`).exists())!.get("a").attributes("href");
    expect(own("widget-ops.needs-action", "ops.shop.defects")).toBe(own("widget-ops.shop", "defects"));
    expect(own("widget-ops.needs-action", "ops.roadside.needs")).toBe(own("widget-ops.roadside", "needs"));
    expect(own("widget-ops.needs-action", "ops.roadside.needs")).toContain("from=2026-09-12&to=2026-10-12");
  });

  it("admits each row by its own card's gate — a reader without the section gets neither the card nor its alarms (D-FM4)", async () => {
    // The technician of the gate test above: equipment and the shop, no dispatch, roster, hazmat or safety.
    session.role = "technician";
    session.sections = { equipment: "manage" };
    const w = await settled();
    expect(needs(w)).toEqual([
      ["ops.shop.defects", "52"],
      ["ops.seats.no-driver", "3"],
      ["ops.truck-papers.inspection_overdue", "1"],
    ]);
    // …and the refused cards' reads were never started for them: Roadside's is asked only by a mounted source.
    const before = roadsideAsked.length;
    await settled();
    expect(roadsideAsked.length).toBe(before);
  });

  it("does not call an unanswered check clear: a dash is counted apart and nothing is claimed", async () => {
    shop.value = undefined as unknown as typeof SHOP;
    const w = await settled();
    expect(needs(w).map(([k]) => k)).not.toContain("ops.shop.defects");
    expect(w.get("[data-test='needs-action-unknown']").text()).toBe("1 check has not answered yet.");
    expect(w.find("[data-test='needs-action-clear']").exists()).toBe(false);
  });

  it("says nothing needs a person only once every check has answered so", async () => {
    // Equipment and the shop alone, and the shop has nothing open: the trucks decide.
    session.role = "technician";
    session.sections = { equipment: "manage" };
    shop.value = { ...SHOP, unresolvedDefects: 0 };
    // Every truck seated and in date → three alarm checks, all zero.
    vehicles.value = [{ id: "t6", status: "active", assigned_driver_id: "a", dot_annual_inspection_expires_at: "2027-06-01", registration_expires_at: "2027-06-01" }] as typeof VEHICLES;
    const clear = await settled();
    expect(needs(clear)).toEqual([]);
    expect(clear.get("[data-test='needs-action-clear']").text()).toBe("Nothing needs a person right now.");
    expect(clear.get("[data-test='widget-ops.needs-action']").text()).toContain("4 checks are clear");
    // The trucks have not arrived: nothing is listed, and nothing is claimed either.
    vehicles.value = undefined;
    const waiting = await settled();
    expect(needs(waiting)).toEqual([]);
    expect(waiting.find("[data-test='needs-action-clear']").exists()).toBe(false);
    expect(waiting.get("[data-test='needs-action-unknown']").text()).toBe("3 checks have not answered yet.");
  });

  it("leaves a rate to its card: an out-of-service percentage has no place in a list ordered by counts", async () => {
    const keys = needs(await settled()).map(([k]) => k);
    expect(keys).not.toContain("ops.roadside.vehicle-oos");
    expect(keys).not.toContain("ops.roadside.driver-oos");
  });
});

describe("every count is the row count behind its door (D-FM7)", () => {
  it("board: the parked pool is out, as it is on the board's All", () => {
    const w = render();
    expect([tile(w, "total"), tile(w, "loaded"), tile(w, "empty"), tile(w, "in-shop")]).toEqual(["4", "2", "1", "1"]);
    expect([n(w, "late"), n(w, "hos-low"), n(w, "no-gps"), n(w, "no-next"), n(w, "uncovered")]).toEqual(["1", "1", "1", "1", "3"]);
  });

  it("driver files: drivers, not items", () => {
    const w = render();
    expect([n(w, "expired"), n(w, "expiring"), n(w, "not_started")]).toEqual(["1", "1", "1"]);
    expect(w.get("[data-test='dq-next']").text()).toBe("Next: Driver a — Medical card, 4 days overdue");
  });

  it("seats: active drivers, and a retired truck's driver holds nothing", () => {
    const w = render();
    expect(n(w, "no-truck")).toBe("2"); // b (only on retired t5) and c
  });

  it("seats: counts the board's trucks — the shop's in, the pool and the wound-down on one line of their own", () => {
    // 2026-11-26: "179 of 196" beside a board of 181, 14 of 17 empty seats parked in fleet '1' (D-FM10).
    const w = render();
    expect(n(w, "no-driver")).toBe("3"); // t2, t3, t8 — not t6 (wound down), not t7 (pool)
    expect(n(w, "off-board")).toBe("2"); // t6, t7 — ordered t4 and retired t5 are not in service
    const card = w.get("[data-test='widget-ops.seats']").text();
    expect(card).toContain("1 of 4"); // t1 of t1, t2, t3, t8
    expect(card).toContain("1 parked in the Unassigned pool · 1 sold or retiring");
    expect(card).not.toContain("on order");
  });

  it("paperwork: active trucks only, read from each truck's file, with date-only and nothing-on-file on lines of their own", () => {
    const w = render();
    // t1 lapsed, t2 inside the window, t1/t2/t6 McLeod's dates only, t3 nothing; retired t5 is out.
    expect([n(w, "inspection_overdue"), n(w, "inspection_due"), n(w, "inspection_date_only"), n(w, "inspection_missing")]).toEqual(["1", "1", "3", "1"]);
    // t2's filed registration (good to 2027-09-30) outranks McLeod's lapsed 2026-09-30: no longer overdue.
    expect([n(w, "registration_overdue"), n(w, "registration_due"), n(w, "registration_date_only"), n(w, "registration_missing")]).toEqual(["0", "0", "2", "1"]);
  });

  it("shop: the summary's counts, each the length of its list on the server, and the oldest order's age", () => {
    const w = render();
    expect([n(w, "work-orders"), n(w, "defects")]).toEqual(["24", "52"]);
    // Shelf counting is hidden (Q-MX8, `lib/shelfCounting.ts`), and its "Shelves to reorder" row with it.
    expect(w.find("[data-test='widget-ops.shop']").text()).not.toContain("Shelves to reorder");
    // The carrier's calendar day, counted the way the list's "Open for" column counts it.
    expect(w.get("[data-test='widget-ops.shop']").text()).toContain("oldest open 110 days");
  });

  it("shop: no age without an open order, and a dash — never a zero — before the answer arrives", () => {
    shop.value = { ...SHOP, openWorkOrders: 0, oldestOpenWorkOrderAt: null as unknown as string };
    expect(render().get("[data-test='widget-ops.shop']").text()).not.toContain("oldest");
    shop.value = undefined as unknown as typeof SHOP;
    const w = render();
    expect([n(w, "work-orders"), n(w, "defects")]).toEqual(["—", "—"]);
  });

  it("roadside: asks for the page's range, and gives FMCSA's rates with what each is of (IC16)", () => {
    const w = render();
    expect(roadsideAsked.at(-1)).toEqual({ from: "2026-09-12", to: "2026-10-12" });
    expect([n(w, "inspections"), n(w, "clean"), n(w, "vehicle-oos"), n(w, "driver-oos"), n(w, "hazmat-oos"), n(w, "points"), n(w, "needs")])
      .toEqual(["32", "59%", "17%", "3%", "1", "214", "9"]);
    const card = w.get("[data-test='widget-ops.roadside']").text();
    expect(card).toContain("4 of 23 vehicle inspections");
    expect(card).toContain("1 of 32 driver inspections");
    expect(card).toContain("Tires");
  });

  it("roadside: a rate of no inspections is a dash, never 0%", () => {
    roadside.value = { ...ROADSIDE, stats: { ...ROADSIDE.stats, vehicleOos: rate(0, 0) } };
    expect(n(render(), "vehicle-oos")).toBe("—");
  });

  it("roadside: says how current FMCSA's record is, and says it plainly when the feed has stopped (IC1c)", () => {
    expect(render().get("[data-test='widget-ops.roadside'] [data-test='feed']").text()).toMatch(/^FMCSA's record as of 10\/13\/2026/);
    roadside.value = { ...ROADSIDE, feed: { ...FEED, state: "ours_late" } };
    const late = render().get("[data-test='widget-ops.roadside'] [data-test='feed']");
    expect(late.text()).toContain("the daily fetch is failing");
    expect(late.classes()).toContain("text-caution-700");
  });

  it("roadside: a dash — never a zero — before the answer arrives", () => {
    roadside.value = undefined;
    const w = render();
    expect([n(w, "inspections"), n(w, "clean"), n(w, "vehicle-oos"), n(w, "driver-oos"), n(w, "hazmat-oos")]).toEqual(["—", "—", "—", "—", "—"]);
  });

  it("hiring and hazmat: the board's split and the badge's count", () => {
    const w = render();
    expect([n(w, "us"), n(w, "them"), n(w, "needs-review")]).toEqual(["2", "1", "2"]);
  });

  it("links each count to the list that holds exactly those rows", () => {
    session.role = "admin"; // every page opens for the admin, so every door renders
    const h = hrefs(render());
    for (const door of [
      "/assignments?scope=all", "/assignments?scope=all&queue=empty", "/assignments?scope=all&queue=late",
      "/assignments?scope=all&queue=hos-low", "/loads?queue=uncovered&scope=all",
      "/drivers?file=expired", "/drivers?file=not_started",
      "/vehicles?status=any&check=no_driver", "/drivers?status=active&seat=none", "/vehicles?status=any&check=off_board",
      "/vehicles?check=inspection_overdue", "/vehicles?check=registration_missing",
      "/?tab=fleet", "/anomalies", "/idling", "/hazmat/review", "/recruitment", "/recruitment?waiting=them",
      "/shop/work-orders", "/shop/defects",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12&clean=1",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12&oos=vehicle&insp=vehicle",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12&oos=driver&insp=driver",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12&oos=hazmat",
      "/roadside-inspections?view=needs&from=2026-09-12&to=2026-10-12",
      "/roadside-inspections?view=all&from=2026-09-12&to=2026-10-12&category=23",
    ]) expect(h, door).toContain(door);
  });
});
