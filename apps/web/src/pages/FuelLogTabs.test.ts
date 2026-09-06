import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";
import type { EfsFilters } from "@/features/fuel/useEfsData";
import type { FuelFilters } from "@/features/fuel/useFuelLog";

/**
 * FUEL-C2 — the Fuel Log absorbs Transactions and Rejections, and nothing is lost in the merge.
 *
 * ── WHY THIS SUITE IS THE STEP'S DONE-WHEN AND NOT A FORMALITY ──────────────────────────────────
 * Three pages became three tabs of a fourth. Every one of the four risks here is invisible in a
 * diff of ~1,000 moved lines, and each has a measured precedent in this repo:
 *
 *  · **The count.** X8: one shared count on the fuel-spend page was the unfiltered fill total on
 *    four of its six tabs. Each tab here owns its filter bar so the number beside the filters is the
 *    number of rows below them — asserted per tab, by label.
 *  · **The columns.** A merge that "extracts" three tables into one file is exactly where a column
 *    quietly goes missing. Each tab's headers are pinned against the page it came from.
 *  · **The gate.** `/transactions` and `/rejections` were catalogued `section("fuel")`; `/fuel-log`
 *    is `always`. Absorbing them without a check hands a decline — a fraud signal — to a recruiter
 *    and a technician, both of whom carry `fuel: "none"` and both of whom reach this path today.
 *  · **The shared window.** The whole point of the merge is that a window and a truck mean one thing
 *    across the three views. A tab switch that dropped them would leave the merge cosmetic.
 *
 * ⚠ Two traps this file already pays: `DataTable` renders as CARDS under jsdom (`useMediaQuery`
 * reports nothing), so an assertion about `th` passes vacuously unless the desktop breakpoint is
 * stubbed; and a spy referenced inside a `vi.mock` factory must be `vi.hoisted`.
 */

// The session, in the real shape `stores/session.ts` exposes: `can` is manage-only, `canView` is
// view-or-manage. A mock that collapsed the two would pass whatever the page did, which is the
// failure the gate assertions below exist to catch.
const session = vi.hoisted(() => ({
  role: "admin" as string | null,
  can: (_s: string): boolean => true,
  canView: (_s: string): boolean => true,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

/** Put the mocked session in one role's shoes, from the shared matrix rather than hand-set booleans. */
async function asRole(role: string) {
  const { sectionAccess } = await import("@silvicom/shared");
  session.role = role;
  session.can = (s: string) => sectionAccess(role as never, s as never) === "manage";
  session.canView = (s: string) => sectionAccess(role as never, s as never) !== "none";
}

/**
 * The filter refs each list query was handed, captured at setup and read at assertion time — they
 * are live refs, so this sees what the tab is asking for NOW rather than what it asked for first.
 */
const seen = vi.hoisted(() => ({
  fuel: null as { value: FuelFilters } | null,
  txn: null as { value: EfsFilters } | null,
  declined: null as { value: EfsFilters } | null,
}));

/**
 * One row per list, because `DataTable` renders its empty state INSTEAD of the table — with no
 * `<thead>` — so a column assertion against a zero-row fixture passes by finding nothing. Same
 * vacuous-pass shape as the card-layout trap in the header, one layer down. `total` is 7 on all
 * three so that only the NOUN beside the count can say which list it describes.
 */
const listOf = (row: Record<string, unknown>) => ({
  data: ref({ rows: [row], total: 7 }),
  isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
});

vi.mock("@/features/fuel/useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useEfsTransactions: (f: { value: EfsFilters }) => {
    seen.txn = f;
    return listOf({ id: "t1", unit: "654", tran_date: "2026-08-15", fueled_at: "2026-08-15T14:00:00Z", state: "TX" });
  },
  useDeclinedTransactions: (f: { value: EfsFilters }) => {
    seen.declined = f;
    return listOf({ id: "d1", unit: "654", declined_at: "2026-08-15T14:00:00Z", error_code: "51", state: "TX" });
  },
  useEfsFacets: () => ({ data: ref(undefined) }),
  useEfsRowCoverage: () => ({ data: ref(null) }),
}));
vi.mock("@/features/fuel/useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: (f: { value: FuelFilters }) => {
    seen.fuel = f;
    return listOf({ id: "f1", vehicle_id: "v-654", driver_id: null, fueled_at: "2026-08-15T14:00:00Z", gallons: 100, has_anomaly: false, case_level: "clear", case_score: 0, case_signals: [], case_gates: null });
  },
  useFuelRangeTotals: () => ({ data: ref(null) }),
  useCreateFillUp: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({
    data: ref([
      { id: "v-654", unit_number: "654", status: "active" },
      // A second truck, so a truck LIST is a list of two rather than one repeated (FUEL-P1).
      { id: "v-655", unit_number: "655", status: "active" },
    ]),
  }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: ref([]) }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));
// See the header: without this the table renders as cards and every header assertion is vacuous.
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

import FuelLogPage from "./FuelLogPage.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-log", component: { template: "<div/>" }, meta: { title: "Fuel Log" } }],
  });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelLogPage, { global: { plugins: [router, pinia, VueQueryPlugin] } });
  await flushPromises();
  return { w, router };
}

const headers = (w: { findAll: (s: string) => { text: () => string }[] }) => w.findAll("th").map((h) => h.text().trim());
const tabLabels = (w: { findAll: (s: string) => { text: () => string }[] }) =>
  w.findAll('[role="tab"]').map((b) => b.text().trim());

beforeEach(async () => {
  seen.fuel = seen.txn = seen.declined = null;
  await asRole("admin");
});

describe("FuelLogPage — three views of one week's fuel, under one window (D-FUI1)", () => {
  it("opens on Fills, and names the three tabs", async () => {
    const { w } = await mountAt("/fuel-log");
    expect(tabLabels(w)).toEqual(["Fills", "Declines", "Source records"]);
    expect(headers(w)).toContain("MPG");
    expect(seen.fuel).not.toBeNull();
    // The other two tabs are not merely hidden — an unmounted tab must not be querying.
    expect(seen.declined).toBeNull();
    expect(seen.txn).toBeNull();
  });

  it("takes the tab from the URL, so a link opens on what its sender was looking at", async () => {
    const { w } = await mountAt("/fuel-log?tab=declines");
    expect(headers(w)).toContain("Risk");
    expect(seen.declined).not.toBeNull();
    expect(seen.fuel).toBeNull();

    const src = await mountAt("/fuel-log?tab=source");
    expect(headers(src.w)).toContain("Tran Date");
    expect(src.w.findAll("th").map((h) => h.text().trim())).toContain("Currency");
  });

  it("lands a stale or hand-edited tab name on Fills rather than on nothing", async () => {
    const { w } = await mountAt("/fuel-log?tab=nonsense");
    expect(headers(w)).toContain("MPG");
  });

  /**
   * X8, generalised. The count in the filter bar is the count of what THIS tab shows — asserted by
   * the noun beside it, because all three fixtures return the same 7 rows and only the label can
   * tell which list the number is describing.
   */
  it("counts what the open tab is showing, in that tab's own noun", async () => {
    expect((await mountAt("/fuel-log")).w.text()).toContain("7 fill-ups");
    expect((await mountAt("/fuel-log?tab=declines")).w.text()).toContain("7 declines");
    expect((await mountAt("/fuel-log?tab=source")).w.text()).toContain("7 transactions");
  });

  /**
   * Every column each page carried, on the tab that replaced it. Written out rather than snapshotted:
   * a snapshot of a merge records whatever the merge did, and the question here is whether it matches
   * the three pages that existed before it.
   */
  it("keeps every column each page had", async () => {
    expect(headers((await mountAt("/fuel-log")).w)).toEqual([
      "Vehicle", "When", "Driver", "Odometer", "Miles", "Gallons", "$/gal", "MPG", "Status",
    ]);
    expect(headers((await mountAt("/fuel-log?tab=declines")).w)).toEqual([
      "Unit", "Risk", "Date / Time", "Card #", "Invoice", "Driver", "Location", "City", "State",
      "Error", "Description", "Policy",
    ]);
    expect(headers((await mountAt("/fuel-log?tab=source")).w)).toEqual([
      "Unit", "Tran Date", "Time", "Card #", "Invoice", "Driver", "Odometer", "Location", "City",
      "State", "Item", "Unit Price", "Qty", "Amt", "Fees", "DB", "Currency",
    ]);
  });
});

describe("FuelLogPage — the window and the truck are one thing across the three tabs", () => {
  it("hands the URL's truck to whichever tab is open, as a unit and as a vehicle id", async () => {
    // The fills query keys on `vehicle_id` and the two raw feeds key on the text `unit`. One shared
    // parameter, resolved per tab — the thing that makes "654 in August" answerable in one place.
    await mountAt("/fuel-log?unit=654&from=2026-08-01&to=2026-08-31");
    expect(seen.fuel?.value.vehicleIds).toEqual(["v-654"]);
    expect(seen.fuel?.value.from).toBe("2026-08-01");
    expect(seen.fuel?.value.to).toBe("2026-08-31");

    await mountAt("/fuel-log?tab=declines&unit=654&from=2026-08-01&to=2026-08-31");
    expect(seen.declined?.value.units).toEqual(["654"]);
    expect(seen.declined?.value.from).toBe("2026-08-01");

    await mountAt("/fuel-log?tab=source&unit=654");
    expect(seen.txn?.value.units).toEqual(["654"]);
  });

  /**
   * FUEL-P1. `?unit=654` was a single value and is now a one-element list, which is what lets the
   * parameter keep its name: every `/fuel-log?unit=654` in a ticket, an email or a bookmark still
   * means the same screen. This is the assertion that fails if somebody "tidies" it into `?units=`.
   */
  it("reads a comma-separated truck list, and still reads the single value old links carry", async () => {
    await mountAt("/fuel-log?unit=654,655");
    expect(seen.fuel?.value.vehicleIds).toEqual(["v-654", "v-655"]);

    await mountAt("/fuel-log?tab=source&unit=654,655");
    expect(seen.txn?.value.units).toEqual(["654", "655"]);

    await mountAt("/fuel-log?tab=declines&unit=654,655");
    expect(seen.declined?.value.units).toEqual(["654", "655"]);
  });

  /**
   * ⚠ The three states of the fills filter, and the middle one is where the bug would live: no trucks
   * named is the whole fleet (`undefined`, no predicate at all), and named-but-unresolvable is an
   * EMPTY list, which PostgREST renders `vehicle_id=in.()` and answers with nothing.
   */
  it("asks for no truck filter at all when none is chosen, rather than an empty list", async () => {
    await mountAt("/fuel-log");
    expect(seen.fuel?.value.vehicleIds).toBeUndefined();
  });

  /**
   * A unit the fleet does not have must narrow to nothing, never widen to everything. Leaving
   * `vehicleId` undefined when the lookup fails would show the WHOLE fleet's fills under a filter bar
   * reading "999" — the confidently-wrong answer this section spent FUEL-T5 removing.
   */
  it("shows no fills for a truck this fleet does not have, rather than all of them", async () => {
    await mountAt("/fuel-log?unit=999");
    expect(seen.fuel?.value.vehicleIds).toEqual([]);
  });

  /**
   * The mixed case, which is the one a real link produces: 654 is a truck and 999 is a unit EFS
   * printed for something the roster has no row for (696 and the three T00x units, measured in
   * production 2026-09-04). The filter must narrow to the trucks it CAN resolve rather than dropping
   * the whole scope or matching nothing.
   */
  it("resolves the trucks it knows and quietly ignores the units it does not", async () => {
    await mountAt("/fuel-log?unit=654,999");
    expect(seen.fuel?.value.vehicleIds).toEqual(["v-654"]);
  });

  it("carries the window and the truck across a tab switch", async () => {
    const { w } = await mountAt("/fuel-log?unit=654&from=2026-08-01&to=2026-08-31");
    const declines = w.findAll('[role="tab"]').find((b) => b.text().trim() === "Declines");
    await declines!.trigger("click");
    await flushPromises();
    expect(seen.declined?.value.units).toEqual(["654"]);
    expect(seen.declined?.value.from).toBe("2026-08-01");
    expect(seen.declined?.value.to).toBe("2026-08-31");
  });

  it("writes the tab back to the URL, so the view can be sent to somebody", async () => {
    const { w, router } = await mountAt("/fuel-log");
    const source = w.findAll('[role="tab"]').find((b) => b.text().trim() === "Source records");
    await source!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("source");
  });
});

/**
 * The gate the merge would otherwise have dissolved. `/fuel-log` is catalogued `always`; the two
 * pages it absorbed were `section("fuel")`. `recruiter` and `technician` both carry `fuel: "none"`
 * and both can reach this path — so without a check they would have gained a fraud signal and the
 * carrier's whole EFS transaction history on a screen they already had.
 */
describe("FuelLogPage — absorbing two gated pages does not widen who can read them", () => {
  it("shows a role without the fuel section the Fills tab only, and no tab strip", async () => {
    await asRole("recruiter");
    const { w } = await mountAt("/fuel-log");
    expect(tabLabels(w)).toEqual([]);
    expect(headers(w)).toContain("MPG");
    expect(seen.declined).toBeNull();
    expect(seen.txn).toBeNull();
  });

  it("refuses a direct link to an absorbed tab, and lands on Fills instead of a blank page", async () => {
    await asRole("technician");
    const { w } = await mountAt("/fuel-log?tab=declines");
    expect(headers(w)).toContain("MPG");
    expect(seen.declined).toBeNull();
  });

  it("still admits every role that could open the two pages before the merge", async () => {
    // `accountant` and `dispatcher` hold `fuel: "view"` — the level the two retired surfaces asked.
    for (const role of ["accountant", "dispatcher", "auditor", "safety_manager"]) {
      await asRole(role);
      const { w } = await mountAt("/fuel-log?tab=declines");
      expect(tabLabels(w), role).toEqual(["Fills", "Declines", "Source records"]);
      expect(headers(w), role).toContain("Risk");
    }
  });
});
