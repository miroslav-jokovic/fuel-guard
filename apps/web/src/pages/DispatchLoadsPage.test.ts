import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";

vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: computed(() => "America/Chicago") }) }));
vi.mock("@/features/dispatch/DispatchLoadDrawer.vue", () => ({ default: { template: "<div/>" } }));

/**
 * The Loads page beside the Dispatch board (DISPATCH-BOARD-PLAN §5.3, DB5b), mounted. The scope rule is
 * `dispatchScope.test.ts`'s; what only shows here is the wiring: the page opens on In transit and on
 * My fleet for a linked dispatcher, "mine" counts the loads on my fleet's trucks AND the ones I
 * dispatch, Uncovered is not emptied by My fleet, the board's link lands on All, the truck opens on
 * the board, and the on-time badge appears exactly where the board has a verdict.
 */
const load = (id: string, status: string, vehicleId: string | null, unit: string | null, dispatcher: string | null, extra = {}) => ({
  id, ref: id, status, source: "tms", external_status: status === "in_transit" ? "P" : "A", equipment: null, hazmat: false,
  vehicle_id: vehicleId, vehicle_unit: unit, trailer_unit: null, driver_id: vehicleId ? "d" : null, driver_name: null,
  dispatcher_external_id: dispatcher, dispatcher_name: dispatcher, customer_name: null, stops: [], last_dispatch: null,
  ...extra,
});
const LOADS = [
  load("L-mine-fleet", "in_transit", "v-773", "773", "asen"), // my fleet's truck, a colleague dispatching
  load("L-i-dispatch", "in_transit", "v-801", "801", "vinniev"), // someone else's truck, I dispatch it
  load("L-not-mine", "in_transit", "v-900", "900", "asen"),
  load("L-next", "pending_approval", "v-773", "773", "vinniev"), // planned behind L-mine-fleet
  load("L-uncovered", "pending_approval", null, null, null),
];
vi.mock("@/features/dispatch/useDispatchLoads", async (orig) => ({
  ...(await orig<typeof import("@/features/dispatch/useDispatchLoads")>()),
  useLoadsQuery: () => ({ data: ref(LOADS), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: () => {}, isFetching: ref(false) }),
  useExceptionsQuery: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false), refetch: () => {}, isFetching: ref(false) }),
  useResolveException: () => ({ isPending: ref(false), mutateAsync: async () => {} }),
}));

const boardRow = (vehicleId: string, fleetCode: string | null, loadId: string | null, onTime: DispatchBoardRow["onTime"]) =>
  ({ vehicleId, fleetCode, current: loadId ? { loadId, dispatcherId: null } : null, next: null, onTime }) as unknown as DispatchBoardRow;
const board = vi.hoisted(() => ({ value: null as DispatchBoardResponse | null }));
vi.mock("@/features/dispatch/useDispatchBoard", () => ({
  useDispatchBoardQuery: () => ({ data: computed(() => board.value) }),
}));
import DispatchLoadsPage from "./DispatchLoadsPage.vue";

const response = (linked: boolean): DispatchBoardResponse => ({
  generatedAt: "2026-10-10T15:00:00Z",
  rows: [boardRow("v-773", "VINNIEV", "L-mine-fleet", "late"), boardRow("v-801", "VLADI", "L-i-dispatch", "on_time"), boardRow("v-900", "VLADI", "L-not-mine", "unknown")],
  scope: linked ? { linked, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] } : { linked, fleetCodes: [], dispatcherIds: [] },
  fleets: [{ code: "VINNIEV", dispatcherId: "vinniev" }, { code: "VLADI", dispatcherId: null }],
  dispatchers: [{ id: "vinniev", name: "Vinnie V", isSystem: false }, { id: "asen", name: "Asen", isSystem: false }],
  uncoveredCount: 1,
  hosAsOf: null,
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

async function mountPage(path = "/loads") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/loads", name: "loads", component: { template: "<div/>" } },
      { path: "/loads/:id", name: "load-detail", component: { template: "<div/>" } },
      { path: "/assignments", name: "assignments", component: { template: "<div/>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(DispatchLoadsPage, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}
const refs = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("tbody tr").map((tr) => tr.find("td button").text());
async function openTab(w: Awaited<ReturnType<typeof mountPage>>, label: string) {
  await w.findAll("[role=tab]").find((t) => t.text().startsWith(label))!.trigger("click");
  await flushPromises();
}

describe("the Loads page beside the dispatch board", () => {
  it("opens a linked dispatcher on In transit, My fleet: their fleet's trucks and the loads they dispatch", async () => {
    board.value = response(true);
    const w = await mountPage();
    expect(w.get("[role=tab][aria-selected=true]").text()).toContain("In transit");
    expect(refs(w)).toEqual(["L-mine-fleet", "L-i-dispatch"]);
  });

  it("opens anyone not linked on All, with every load in transit", async () => {
    board.value = response(false);
    const w = await mountPage();
    expect(refs(w)).toEqual(["L-mine-fleet", "L-i-dispatch", "L-not-mine"]);
  });

  it("puts the planned next load on Upcoming, not In transit", async () => {
    board.value = response(true);
    const w = await mountPage();
    await openTab(w, "Upcoming");
    expect(refs(w)).toEqual(["L-next"]);
  });

  it("does not empty Uncovered under My fleet — no uncovered load has a dispatcher — and says so", async () => {
    board.value = response(true);
    const w = await mountPage();
    await openTab(w, "Uncovered");
    expect(refs(w)).toEqual(["L-uncovered"]);
    expect(w.text()).toContain("Uncovered loads have no dispatcher in McLeod yet");
    // And All agrees with the tabs it sums: mine in transit (2) + upcoming (1) + uncovered (1).
    await openTab(w, "All");
    expect(refs(w)).toEqual(["L-mine-fleet", "L-i-dispatch", "L-next", "L-uncovered"]);
  });

  it("lands the board's uncovered link on All, the scope the link counted in", async () => {
    board.value = response(true);
    const w = await mountPage("/loads?queue=in_transit&scope=all");
    expect(refs(w)).toEqual(["L-mine-fleet", "L-i-dispatch", "L-not-mine"]);
  });

  it("opens a load's truck on the dispatch board", async () => {
    board.value = response(true);
    const w = await mountPage();
    const truck = w.findAll("tbody a").find((a) => a.text() === "773")!;
    expect(truck.attributes("href")).toBe("/assignments?truck=773");
  });

  it("shows the board's on-time verdict on the load a truck is hauling, and none on any other", async () => {
    board.value = response(false);
    const w = await mountPage();
    const statusOf = (ref: string) => w.findAll("tbody tr").find((tr) => tr.text().includes(ref))!.findAll("td")[1]!.text();
    expect(statusOf("L-mine-fleet")).toContain("Late");
    expect(statusOf("L-i-dispatch")).toContain("On time");
    await openTab(w, "Upcoming");
    expect(statusOf("L-next")).toBe("Planned");
  });
});
