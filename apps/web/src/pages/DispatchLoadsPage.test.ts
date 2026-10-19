import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const exception = (id: string, loadId: string | null, summary: string) => ({
  id, kind: "declined", load_id: loadId, load_ref: loadId, driver_name: null, summary, occurred_at: "2026-10-10T14:00:00Z", action: "acknowledge",
});
const EXCEPTIONS = [
  exception("e1", "L-mine-fleet", "Declined on my fleet's truck"),
  exception("e2", "L-not-mine", "Declined on someone else's truck"),
  exception("e3", null, "A shift auto-closed"), // names a driver, not a load
];
// One ref for every mount, so a test can land a refetch of the exceptions, as the poll does.
const exceptionsData = ref(EXCEPTIONS);
/** F13: the loads read refused. */
const loadsRead = vi.hoisted(() => ({ fails: false }));
vi.mock("@/features/dispatch/useDispatchLoads", async (orig) => ({
  ...(await orig<typeof import("@/features/dispatch/useDispatchLoads")>()),
  useLoadsQuery: () => ({
    data: ref(loadsRead.fails ? undefined : LOADS),
    isLoading: ref(false),
    isError: ref(loadsRead.fails),
    error: ref(null),
    refetch: () => {},
    isFetching: ref(false),
  }),
  useExceptionsQuery: () => ({ data: exceptionsData, isLoading: ref(false), isError: ref(false), refetch: () => {}, isFetching: ref(false) }),
  useResolveException: () => ({ isPending: ref(false), mutateAsync: async () => {} }),
}));

const boardRow = (vehicleId: string, fleetCode: string | null, loadId: string | null, onTime: DispatchBoardRow["onTime"], milesLeft: number | null = null) =>
  ({ vehicleId, fleetCode, current: loadId ? { loadId, dispatcherId: null } : null, next: null, onTime, milesLeft }) as unknown as DispatchBoardRow;
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
  return Object.assign(w, { router });
}
const refs = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("tbody tr").map((tr) => tr.find("td a").text());
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

  it("keeps the toolbar on Exceptions and narrows them by the same scope, keeping the ones no fleet can claim", async () => {
    board.value = response(true);
    const w = await mountPage();
    await openTab(w, "Exceptions");
    expect(w.find("input[type=search], input").exists()).toBe(true);
    const summaries = () => w.findAll("tbody tr").map((tr) => tr.findAll("td")[1]!.text());
    expect(summaries()).toEqual(["Declined on my fleet's truck", "A shift auto-closed"]);
    expect(w.text()).toContain("2 exceptions");
    // A named fleet is a property the load-less one does not have, so it goes.
    const vladi = await mountPage("/loads?queue=exceptions&scope=all&fleet=VLADI");
    expect(vladi.findAll("tbody tr").map((tr) => tr.findAll("td")[1]!.text())).toEqual(["Declined on someone else's truck"]);
  });

  it("reopens a link's queue, scope and type, with no chip for a primary filter", async () => {
    board.value = response(true);
    const w = await mountPage("/loads?queue=in_transit&scope=all&fleet=VLADI");
    expect(refs(w)).toEqual(["L-i-dispatch", "L-not-mine"]);
    expect(w.text()).not.toContain("Clear all");
  });

  it("clears a narrowed list back to the census choice, keeping the queue and the fleet it was opened on", async () => {
    board.value = response(true);
    const w = await mountPage("/loads?queue=in_transit&scope=all&fleet=VLADI&dispatcher=asen&type=Reefer");
    expect(refs(w)).toEqual([]);
    const clear = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    await clear()!.trigger("click");
    await flushPromises();
    // Dispatched by and Type narrow the list; the census choice (VLADI) says WHICH list it is, as on the board.
    expect(w.router.currentRoute.value.query).toEqual({ queue: "in_transit", scope: "all", fleet: "VLADI" });
    expect(refs(w)).toEqual(["L-i-dispatch", "L-not-mine"]);
    expect(clear()).toBeUndefined();
  });

  /**
   * Q-DBV8 (ruled 2026-10-16): the board's Dispatcher choice, counting THIS list — loads in the open tab,
   * per fleet of their truck — so each option's number is the rows it shows when chosen. Q-DBV9 made it
   * a select in the filter row rather than a strip of buttons.
   */
  describe("counts loads per dispatcher (DBV8, Q-DBV9)", () => {
    const select = async (w: Awaited<ReturnType<typeof mountPage>>) => {
      const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;
      return w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Dispatcher")!;
    };
    const labels = async (w: Awaited<ReturnType<typeof mountPage>>) =>
      ((await select(w)).props("options") as { label: string; count?: string }[]).map((o) => (o.count != null ? `${o.label} (${o.count})` : o.label));
    const choose = async (w: Awaited<ReturnType<typeof mountPage>>, key: string) => {
      (await select(w)).vm.$emit("update:modelValue", key);
      await flushPromises();
    };
    const chosen = async (w: Awaited<ReturnType<typeof mountPage>>) => (await select(w)).props("modelValue");

    it("counts the open tab's loads, Mine first, every working fleet even at 0", async () => {
      board.value = response(true);
      const w = await mountPage();
      expect(w.find("[aria-label='Loads per dispatcher']").exists()).toBe(false);
      expect(await labels(w)).toEqual(["Mine (2)", "All (3)", "VINNIEV (1)", "VLADI (2)"]);
      expect(await chosen(w)).toBe("mine");
      await openTab(w, "Upcoming");
      expect(await labels(w)).toEqual(["Mine (1)", "All (1)", "VINNIEV (1)", "VLADI (0)"]);
    });

    it("shows exactly the loads an option counted when it is chosen", async () => {
      board.value = response(true);
      const w = await mountPage();
      await choose(w, "VLADI");
      expect(w.router.currentRoute.value.query).toEqual({ scope: "all", fleet: "VLADI" });
      expect(refs(w)).toEqual(["L-i-dispatch", "L-not-mine"]);
      expect(await chosen(w)).toBe("VLADI");
      await choose(w, "");
      expect(w.router.currentRoute.value.query).toEqual({ scope: "all" });
      expect(refs(w)).toHaveLength(3);
    });

    it("names a load with no truck apart from a fleet, and counts Uncovered under Mine as the table does", async () => {
      board.value = response(true);
      const w = await mountPage("/loads?queue=uncovered");
      expect(await labels(w)).toEqual(["Mine (1)", "All (1)", "VINNIEV (0)", "VLADI (0)", "No truck (1)"]);
      await choose(w, "__no_truck__");
      expect(refs(w)).toEqual(["L-uncovered"]);
      expect(await chosen(w)).toBe("__no_truck__");
      // A chosen option stays listed on a tab where it counts nothing, so it can be seen and left.
      await openTab(w, "In transit");
      expect((await labels(w)).at(-1)).toBe("No truck (0)");
    });

    it("offers no Mine to a reader linked to no McLeod login", async () => {
      board.value = response(false);
      const w = await mountPage();
      expect(await labels(w)).toEqual(["All (3)", "VINNIEV (1)", "VLADI (2)"]);
    });

    it("counts under the search and Dispatched by, which narrow every option alike", async () => {
      board.value = response(true);
      const w = await mountPage("/loads?dispatcher=asen");
      expect(await labels(w)).toEqual(["Mine (1)", "All (2)", "VINNIEV (1)", "VLADI (1)"]);
      // Dispatched by sits under the toolbar's Filters, which counts it, and shows as a chip.
      expect(w.findAll("button").find((b) => b.text().startsWith("Filters"))!.text()).toBe("Filters 1");
      expect(w.text()).toContain("Dispatched by");
      const searched = await mountPage("/loads?search=801");
      expect(await labels(searched)).toEqual(["Mine (1)", "All (1)", "VINNIEV (0)", "VLADI (1)"]);
    });

    it("counts exceptions on Exceptions, the one with no load in All and Mine only", async () => {
      board.value = response(true);
      const w = await mountPage("/loads?queue=exceptions");
      expect(await labels(w)).toEqual(["Mine (2)", "All (3)", "VINNIEV (1)", "VLADI (1)"]);
      // Dispatched by names a property a load-less exception lacks, so it leaves every count.
      expect((await labels(await mountPage("/loads?queue=exceptions&dispatcher=asen"))).slice(0, 2)).toEqual(["Mine (1)", "All (2)"]);
      // And the choice counts what the search left, as the table does.
      expect((await labels(await mountPage("/loads?queue=exceptions&search=auto-closed"))).slice(0, 2)).toEqual(["Mine (1)", "All (1)"]);
    });
  });

  it("writes the queue and the sort into the URL", async () => {
    board.value = response(false);
    const w = await mountPage();
    await openTab(w, "Upcoming");
    expect(w.router.currentRoute.value.query).toEqual({ queue: "upcoming" });
    await openTab(w, "In transit");
    await w.findAll("thead button").find((b) => b.text() === "Load #")!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ sort: "ref", dir: "asc" });
    expect(refs(w)).toEqual(["L-i-dispatch", "L-mine-fleet", "L-not-mine"]);
  });

  /**
   * D-US8: the Exceptions feed pages like the loads do — it is every open exception in the org. A
   * pasted `?page=2` shows the 21st–40th, and is not pulled back to page 1 by the empty LOADS list that
   * tab leaves behind; a search change starts again at page 1.
   */
  describe("pages the Exceptions feed", () => {
    const many = Array.from({ length: 45 }, (_, i) => exception(`x${i + 1}`, null, `Shift ${String(i + 1).padStart(2, "0")} auto-closed`));
    const summaries = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("tbody tr").map((tr) => tr.findAll("td")[1]!.text());

    it("shows exceptions 21–40 on a pasted ?page=2, and a search goes back to page 1", async () => {
      board.value = response(false);
      const saved = EXCEPTIONS.splice(0, EXCEPTIONS.length, ...many);
      try {
        const w = await mountPage("/loads?queue=exceptions&page=2");
        expect(summaries(w)).toEqual(many.slice(20, 40).map((e) => e.summary));
        expect(w.router.currentRoute.value.query).toEqual({ queue: "exceptions", page: "2" });

        w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "Shift");
        await flushPromises();
        expect(w.router.currentRoute.value.query).toEqual({ queue: "exceptions", search: "Shift" });
        expect(summaries(w)[0]).toBe("Shift 01 auto-closed");
      } finally {
        EXCEPTIONS.splice(0, EXCEPTIONS.length, ...saved);
      }
    });

    it("pulls the page back when the feed shrinks under it, rather than showing an empty page 3", async () => {
      board.value = response(false);
      const saved = EXCEPTIONS.splice(0, EXCEPTIONS.length, ...many);
      try {
        const w = await mountPage("/loads?queue=exceptions&page=3");
        expect(summaries(w)).toEqual(many.slice(40).map((e) => e.summary));
        exceptionsData.value = many.slice(0, 40); // five were cleared elsewhere; the poll lands
        await flushPromises();
        expect(w.router.currentRoute.value.query).toEqual({ queue: "exceptions", page: "2" });
        expect(summaries(w)).toEqual(many.slice(20, 40).map((e) => e.summary));
      } finally {
        EXCEPTIONS.splice(0, EXCEPTIONS.length, ...saved);
        exceptionsData.value = EXCEPTIONS;
      }
    });
  });
});

/**
 * DBV7 (DISPATCH-BOARD-V2-PLAN §3.2, Q-DBV6): the Dispatch column starts hidden, and the Delivery cell
 * gives the board's answer — its appointment, and for the load a truck hauls now, the board's miles left.
 */
describe("the Loads page as the dispatchers read it (DBV7)", () => {
  // The column picker's choice is per browser, and the repo's jsdom has no storage of its own.
  beforeEach(() => {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true, writable: true,
      value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) },
    });
  });
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));
  const stop = (seq: number, kind: "pickup" | "dropoff", extra = {}) => ({
    seq, kind, name: `Stop ${seq}`, city: "Joliet", state: "IL", appointment_start: "2026-10-16T19:00:00Z", appointment_end: null,
    required_photos: [], ...extra,
  });
  const headers = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("thead th").map((th) => th.text());
  const deliveryOf = (w: Awaited<ReturnType<typeof mountPage>>, ref: string) =>
    w.findAll("tbody tr").find((tr) => tr.text().includes(ref))!.findAll("td")[4]!.text();

  it("hides the Dispatch column until a reader turns it on, and remembers that they did", async () => {
    board.value = response(false);
    const w = await mountPage();
    expect(headers(w)).not.toContain("Dispatch");
    expect(headers(w)).toContain("Delivery");
    const picker = w.findComponent({ name: "ColumnPicker" });
    (picker.props("columns") as { toggle: (k: string) => void }).toggle("dispatch");
    await flushPromises();
    expect(headers(w)).toContain("Dispatch");
    // A bare /loads in the same browser keeps the choice.
    const again = await mountPage();
    expect(headers(again)).toContain("Dispatch");
  });

  it("offers no column picker on Exceptions, another table", async () => {
    board.value = response(false);
    const w = await mountPage("/loads?queue=exceptions");
    expect(w.findComponent({ name: "ColumnPicker" }).exists()).toBe(false);
  });

  it("puts the board's miles left under the delivery appointment of the load a truck hauls, and on no other", async () => {
    const saved = LOADS.splice(0, LOADS.length,
      load("L-hauled", "in_transit", "v-773", "773", "asen", { stops: [stop(1, "pickup"), stop(2, "dropoff")] }),
      load("L-no-fix", "in_transit", "v-801", "801", "asen", { stops: [stop(1, "pickup"), stop(2, "dropoff")] }),
      load("L-later", "pending_approval", "v-773", "773", "asen", { stops: [stop(1, "pickup"), stop(2, "dropoff")] }),
    );
    try {
      board.value = { ...response(false), rows: [boardRow("v-773", "VINNIEV", "L-hauled", "on_time", 1412), boardRow("v-801", "VLADI", "L-no-fix", "unknown", null)] };
      const w = await mountPage("/loads?queue=all");
      expect(deliveryOf(w, "L-hauled")).toContain("Appt 10/16/2026");
      expect(deliveryOf(w, "L-hauled")).toContain("≈ 1,412 mi left");
      // Hauled with no figure from the board: nothing, rather than a dash that reads as a number.
      expect(deliveryOf(w, "L-no-fix")).not.toContain("left");
      expect(deliveryOf(w, "L-later")).not.toContain("left");
    } finally {
      LOADS.splice(0, LOADS.length, ...saved);
    }
  });

  it("keeps the delivery appointment once the truck has arrived, the arrival beneath it", async () => {
    const saved = LOADS.splice(0, LOADS.length,
      load("L-there", "in_transit", "v-773", "773", "asen", {
        stops: [stop(1, "pickup", { actual_arrival_at: "2026-10-15T14:00:00Z" }), stop(2, "dropoff", { actual_arrival_at: "2026-10-16T18:00:00Z" })],
      }),
    );
    try {
      board.value = { ...response(false), rows: [boardRow("v-773", "VINNIEV", "L-there", "on_time", 3)] };
      const w = await mountPage();
      expect(deliveryOf(w, "L-there")).toMatch(/Appt 10\/16\/2026.*Arrived 10\/16\/2026/);
      expect(deliveryOf(w, "L-there")).not.toContain("mi left");
      // A pickup's arrival still replaces its appointment.
      const pickup = w.findAll("tbody tr")[0]!.findAll("td")[3]!.text();
      expect(pickup).toContain("Arrived 10/15/2026");
      expect(pickup).not.toContain("Appt");
    } finally {
      LOADS.splice(0, LOADS.length, ...saved);
    }
  });
});

/**
 * F13 (US6b): a tab's count is the length of a list, and a list that failed to load has none. Before,
 * every load tab read 0 on a failed read — an empty board, as far as the tabs knew.
 */
describe("the queue tabs wait for the loads", () => {
  afterEach(() => {
    loadsRead.fails = false;
  });

  it("prints no count on a load tab when the loads could not be read, and says so", async () => {
    loadsRead.fails = true;
    board.value = response(false);
    const w = await mountPage();
    expect(w.text()).toContain("Could not load the loads.");
    const tabs = w.findAll("[role=tab]");
    const exceptionsTab = tabs.find((t) => t.text().startsWith("Exceptions"))!;
    for (const t of tabs.filter((x) => x !== exceptionsTab)) expect(t.text(), t.text()).not.toMatch(/\d/);
    // The exceptions are their own read, and it answered.
    expect(exceptionsTab.text()).toMatch(/\d/);
  });
});
