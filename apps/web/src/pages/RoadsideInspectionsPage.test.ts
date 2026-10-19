import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import type { RoadsideFeed, RoadsideInspectionDto, RoadsideInspectionWorkDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Roadside inspections (INSPECTION-CHALLENGE-PLAN §6's first slice; FLEET-MANAGER-HOME-PLAN Q-FM7 (a))
 * — the list behind the Roadside card. What it can get wrong that the card's test would not see:
 *
 *   1. **The window is cut on the wrong calendar.** The card's "last 90 days" was cut by the server on
 *      the org's day; the page must ask for the same first day, or its count is not the card's.
 *   2. **The OOS filter is a different predicate.** `?oos=vehicle` must keep exactly the inspections
 *      the server counted, an inspection with both a vehicle and a hazmat order included.
 *   3. **An unmatched unit drops out or reads as ours** (D-IC7).
 *   4. **The toolbar count is a page's, not the list's.**
 */

const inspections = ref<RoadsideInspectionDto[]>([]);
const FEED = { fetchedAt: "2026-10-13T14:17:00Z", sourceUpdatedAt: "2026-10-13T03:02:00Z", state: "fresh" as RoadsideFeed["state"] };
const summary = ref<{ feed: typeof FEED } | undefined>({ feed: FEED });
const askedFrom = ref<string | null | undefined>(undefined);
const work = ref<RoadsideInspectionWorkDto[] | undefined>([]);
const workFrom = ref<string | null | undefined>(undefined);
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r, watchEffect } = await import("vue");
  return {
    useRoadsideInspectionsQuery: (from: Ref<string | null>) => {
      watchEffect(() => (askedFrom.value = from.value));
      return { data: inspections, isLoading: r(false), isError: r(false), refetch: vi.fn() };
    },
    useRoadsideSummaryQuery: () => ({ data: summary }),
    useRoadsideWorkQuery: (from: Ref<string | null>) => {
      watchEffect(() => (workFrom.value = from.value));
      return { data: work, isLoading: r(false), isError: r(false), refetch: vi.fn() };
    },
  };
});
vi.mock("@/composables/useOrgTimezone", () => ({
  useOrgTimezone: () => ({ zone: computed(() => "America/Los_Angeles"), isResolved: computed(() => true) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
// jsdom has no `matchMedia`, so DataTable draws its narrow cards unless a test asks for the desktop table.
const wide = ref(false);
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as Record<string, unknown>), useMediaQuery: () => wide }));

const RoadsideInspectionsPage = (await import("@/pages/RoadsideInspectionsPage.vue")).default;

async function page(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  const w = mount(RoadsideInspectionsPage as never, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

const insp = (id: string, oos: [number, number, number] = [0, 0, 0], o: Partial<RoadsideInspectionDto> = {}): RoadsideInspectionDto => ({
  id, reportNumber: `IL${id}`, reportState: "IL", inspectionDate: "2026-10-09", level: 2, locationDesc: "I-55 MM 210",
  hazmatPlacardRequired: false, violations: 1, driverOos: oos[0], vehicleOos: oos[1], hazmatOos: oos[2],
  units: [{ seq: 1, kind: "tractor", companyNumber: "701", plate: "P1", plateState: "IL", matched: true }], ...o,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2026-10-12 in Los Angeles (the org), already 2026-10-13 in Chicago and UTC.
  vi.setSystemTime(new Date("2026-10-13T06:30:00.000Z"));
  inspections.value = [];
  askedFrom.value = undefined;
  work.value = [];
  workFrom.value = undefined;
  wide.value = false;
  summary.value = { feed: FEED };
});
afterEach(() => vi.useRealTimers());

describe("roadside inspections", () => {
  it("asks for the card's 90 days on the org's calendar, and for the whole record by default", async () => {
    await page("/roadside-inspections?view=all&period=90d");
    expect(askedFrom.value).toBe("2026-07-15");
    await page("/roadside-inspections?view=all");
    expect(askedFrom.value).toBeNull();
  });

  it("filters OOS by the server's predicate — an inspection with two kinds is in both", async () => {
    inspections.value = [insp("1", [0, 1, 1]), insp("2", [1, 0, 0]), insp("3"), insp("4", [0, 2, 0])];
    const vehicle = await page("/roadside-inspections?view=all&period=90d&oos=vehicle");
    expect(vehicle.text()).toContain("2 roadside inspections");
    expect(vehicle.text()).toContain("IL1");
    expect(vehicle.text()).toContain("IL4");
    const hazmat = await page("/roadside-inspections?view=all&period=90d&oos=hazmat");
    expect(hazmat.text()).toContain("1 roadside inspection");
    expect(hazmat.findAll("[data-test='oos']").map((c) => c.text())).toEqual(["Vehicle · Hazmat"]);
  });

  it("shows an unmatched unit as the officer wrote it, marked, never dropped (D-IC7)", async () => {
    inspections.value = [
      insp("1", [0, 0, 0], {
        units: [
          { seq: 1, kind: "tractor", companyNumber: "701", plate: null, plateState: null, matched: true },
          { seq: 2, kind: "trailer", companyNumber: null, plate: "T998", plateState: "WI", matched: false },
        ],
      }),
    ];
    const w = await page("/roadside-inspections?view=all");
    expect(w.findAll("[data-test='unit']").map((u) => u.text())).toEqual(["701", "T998 (WI) · not matched"]);
  });

  it("counts the whole list in the toolbar, past the first page", async () => {
    inspections.value = Array.from({ length: 111 }, (_, i) => insp(String(i)));
    const w = await page("/roadside-inspections?view=all&period=90d");
    expect(w.text()).toContain("111 roadside inspections");
    expect(w.text()).toContain("Showing 1–25 of 111");
  });
});

describe("opening a row", () => {
  async function list() {
    inspections.value = [insp("abc")];
    const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
    await router.push("/roadside-inspections?view=all&period=90d");
    await router.isReady();
    const w = mount(RoadsideInspectionsPage as never, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it("links the report number to the inspection's page, on a phone's cards as on the desktop table", async () => {
    const { w } = await list();
    expect(w.get("a[href='/roadside-inspections/abc']").text()).toBe("ILabc");
    expect(w.text()).toContain("2 · Walk-Around");
  });

  it("opens the inspection's page from anywhere on the desktop row", async () => {
    wide.value = true;
    const { w, router } = await list();
    await w.get("tbody tr td:nth-child(5)").trigger("click");
    // The route's component is a lazy import, so the navigation settles after it loads.
    // The click loads the inspection page's module for the first time in this file — measured 0.8–1.3 s under
    // a full local run, past `waitFor`'s 1 s default — so the wait is for the import, not for the logic.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/roadside-inspections/abc"), { timeout: 5000 });
  });
});

describe("how current the record is (IC1c)", () => {
  it("says it quietly when fresh, and as a caution above the list when the fetch has stopped", async () => {
    const fresh = await page("/roadside-inspections?view=all");
    expect(fresh.get("[data-test='feed']").text()).toMatch(/^FMCSA's record as of/);
    expect(fresh.get("[data-test='feed']").element.tagName).toBe("P");

    summary.value = { feed: { ...FEED, state: "fmcsa_late" } };
    const late = await page("/roadside-inspections?view=all");
    expect(late.get("[data-test='feed']").text()).toContain("FMCSA has not published since");
    expect(late.get("[data-test='feed']").element.tagName).not.toBe("P");
  });
});

/**
 * Needs action (Q-IC17): the inspections with a step open, most urgent first, with the Next step, Driver and
 * CSA points columns — every figure the server's `roadsideNextSteps`, never worked out here.
 */
describe("needs action", () => {
  const line = (id: string, o: Partial<RoadsideInspectionWorkDto> = {}): RoadsideInspectionWorkDto => ({
    id, driver: null, open: { total: 0, byOwner: { safety: 0, maintenance: 0 } }, next: null, points: 0, ...o,
  });
  const open = (title: string, clock: { overdue: boolean; days: number } | null, dueOn: string | null = null) => ({
    open: { total: 1, byOwner: { safety: 0, maintenance: 1 } },
    next: { title, owner: "maintenance" as const, dueOn, clock },
  });

  it("opens on the inspections with a step open, the most overdue first, and asks for the same window as the list", async () => {
    wide.value = true;
    inspections.value = [insp("a"), insp("b"), insp("c"), insp("d")];
    work.value = [
      line("a", open("Truck 1: name the repair", { overdue: false, days: 5 }, "2026-10-17")),
      line("b"),
      // Nine days overdue outranks five days left — sorting on the day count alone would not.
      line("c", open("Truck 2: name the repair", { overdue: true, days: 9 }, "2026-10-03")),
      line("d", { open: { total: 1, byOwner: { safety: 1, maintenance: 0 } }, next: { title: "Say who was driving", owner: "safety", dueOn: null, clock: null } }),
    ];
    const w = await page("/roadside-inspections?period=90d");
    expect(workFrom.value).toBe(askedFrom.value);
    expect(w.findAll("[data-test='next-step']").map((n) => n.text())).toEqual([
      "Truck 2: name the repair Maintenance",
      "Truck 1: name the repair Maintenance",
      "Say who was driving Safety",
    ]);
    expect(w.text()).toContain("9 days overdue");
    expect(w.text()).toContain("Due 10/17/2026 · 5 days left");
    expect(w.get("[role='tab'][aria-selected='true']").text()).toContain("Needs action");
    expect(w.get("[role='tab'][aria-selected='true']").text()).toContain("3");
  });

  it("names the driver on whose word, and the CSA points, on every row of All", async () => {
    wide.value = true;
    inspections.value = [insp("a")];
    work.value = [line("a", { driver: { name: "Ann Roster", by: "samsara" }, points: 63 })];
    const w = await page("/roadside-inspections?view=all");
    expect(w.get("[data-test='driver']").text()).toBe("Ann Roster");
    expect(w.text()).toContain("from Samsara");
    expect(w.get("[data-test='points']").text()).toBe("63");
    expect(w.get("[data-test='next-step']").text()).toBe("Nothing left");
  });

  it("says nothing needs action, rather than that nothing is on the record", async () => {
    inspections.value = [insp("a")];
    work.value = [line("a")];
    expect((await page("/roadside-inspections")).text()).toContain("Nothing needs action.");
  });
});
