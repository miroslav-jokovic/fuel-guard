import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";

vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: computed(() => "America/Chicago") }) }));
vi.mock("@/features/dispatch/AssignmentHistory.vue", () => ({ default: { template: "<div data-test='history'/>" } }));
// The drawer's own reads and rendering are DispatchTruckDrawer.test.ts's; here only WHICH truck it gets.
vi.mock("@/features/dispatch/DispatchTruckDrawer.vue", () => ({
  default: { name: "DispatchTruckDrawer", props: ["row"], emits: ["close"], template: "<div data-test='drawer'>{{ row ? row.unitNumber : 'closed' }}</div>" },
}));

/**
 * The dispatch board, mounted (DISPATCH-BOARD-PLAN DB5). The filtering rules are
 * `dispatchBoardView.test.ts`'s; what is only testable here is the WIRING: the board opens on My fleet
 * for a linked dispatcher and on All — saying why — for anyone else, and the uncovered loads are a link
 * to the Loads page rather than a second list (D-DB5).
 */
const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false };
const row = (unitNumber: string, fleetCode: string): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode, driver: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", empties: null, flags: { ...flags, emptyNow: true },
});
const board = vi.hoisted(() => ({ value: null as DispatchBoardResponse | null }));
vi.mock("@/features/dispatch/useDispatchBoard", () => ({
  useDispatchBoardQuery: () => ({
    data: computed(() => board.value), isLoading: ref(false), isError: ref(false), error: ref(null),
    isFetching: ref(false), refetch: () => {},
  }),
}));
import AssignmentsPage from "./AssignmentsPage.vue";

const response = (linked: boolean): DispatchBoardResponse => ({
  generatedAt: "2026-10-09T20:00:00Z",
  rows: [row("773", "VINNIEV"), row("669", "VINNIEV"), row("801", "VLADI"), row("550", "1")],
  scope: linked ? { linked, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] } : { linked, fleetCodes: [], dispatcherIds: [] },
  fleets: [{ code: "VINNIEV", dispatcherId: "vinniev" }, { code: "VLADI", dispatcherId: null }, { code: "1", dispatcherId: null }],
  dispatchers: [{ id: "vinniev", name: "vinniev", isSystem: false }],
  uncoveredCount: 12,
  hosAsOf: "2026-10-09T19:58:00Z",
});

beforeEach(() => {
  setActivePinia(createPinia());
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

async function mountPage(path = "/assignments") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/assignments", component: { template: "<div/>" } },
      { path: "/loads", name: "loads", component: { template: "<div/>" } },
      { path: "/loads/:id", name: "load-detail", component: { template: "<div/>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(AssignmentsPage, { global: { plugins: [router] } });
  await flushPromises();
  return Object.assign(w, { router });
}
const units = (w: Awaited<ReturnType<typeof mountPage>>) =>
  w.findAll("tbody tr").map((tr) => tr.find("td:first-child div").text());

describe("the dispatch board page", () => {
  it("opens a linked dispatcher on their own fleet", async () => {
    board.value = response(true);
    const w = await mountPage();
    expect(units(w)).toEqual(["773", "669"]);
    expect(w.text()).not.toContain("not linked to a McLeod dispatcher");
  });

  it("opens anyone else on All — without the parked pool — and says why", async () => {
    board.value = response(false);
    const w = await mountPage();
    expect(units(w)).toEqual(["773", "669", "801"]);
    expect(w.text()).toContain("not linked to a McLeod dispatcher");
  });

  it("links the uncovered loads to the Loads page's queue instead of listing them", async () => {
    board.value = response(true);
    const w = await mountPage();
    const link = w.findAll("a").find((a) => a.text().includes("uncovered"))!;
    expect(link.text()).toContain("12 uncovered loads");
    expect(link.attributes("href")).toBe("/loads?queue=uncovered&scope=all");
  });

  it("opens a truck's drawer from its unit number and writes the truck into the URL", async () => {
    board.value = response(true);
    const w = await mountPage();
    expect(w.get("[data-test=drawer]").text()).toBe("closed");
    await w.findAll("tbody tr")[1]!.get("button").trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ truck: "669" });
    expect(w.get("[data-test=drawer]").text()).toBe("669");
  });

  it("opens the drawer a link names with ?truck=, and closing it drops only that key", async () => {
    board.value = response(true);
    const w = await mountPage("/assignments?truck=801&from=loads");
    expect(w.get("[data-test=drawer]").text()).toBe("801");
    w.getComponent({ name: "DispatchTruckDrawer" }).vm.$emit("close");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ from: "loads" });
    expect(w.get("[data-test=drawer]").text()).toBe("closed");
  });
});
