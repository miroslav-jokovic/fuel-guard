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
const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, warningUrgent: false };
const NOW = Date.parse("2026-10-09T20:00:00Z");
/** An empty truck, free now where it stands — or, with `hours`, free that many hours from the board's clock. */
const row = (unitNumber: string, fleetCode: string, o: { hours?: number; state?: string } = {}): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode, driver: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", milesLeft: null, warnings: [], flags: { ...flags, emptyNow: true },
  available: {
    place: null, ...(o.state === "GA" ? { city: "Savannah", state: "GA", postalCode: "31401", lat: 32.08, lng: -81.09 } : { city: "Lakeland", state: "FL", postalCode: "33801", lat: 28.04, lng: -81.95 }),
    at: new Date(NOW + (o.hours ?? 0) * 3_600_000).toISOString(), basis: o.hours ? "appointment" : "now",
  },
});
// A ref, so a test can land the board AFTER the page opened, as the first fetch does in production.
const board = await vi.hoisted(async () => {
  const { shallowRef } = await import("vue");
  return shallowRef<DispatchBoardResponse | null>(null);
});
vi.mock("@/features/dispatch/useDispatchBoard", () => ({
  useDispatchBoardQuery: () => ({
    data: computed(() => board.value), isLoading: ref(false), isError: ref(false), error: ref(null),
    isFetching: ref(false), refetch: () => {},
  }),
}));
// The views themselves are the API's (`savedViews.test.ts`); here, what the board saves and applies.
const savedViews = vi.hoisted(() => ({
  views: [] as { table_id: string; name: string; query: string; updated_at: string }[],
  table: "",
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/composables/useSavedViews", () => ({
  useSavedViews: (table: string) => {
    savedViews.table = table;
    return { views: { value: savedViews.views }, loading: { value: false }, saving: { value: false }, save: savedViews.save, remove: savedViews.remove };
  },
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import AssignmentsPage from "./AssignmentsPage.vue";

const response = (linked: boolean): DispatchBoardResponse => ({
  generatedAt: "2026-10-09T20:00:00Z",
  // Soonest free first is the board's order: 773 now, 669 in 5 h, 801 (Georgia) in 30 h.
  rows: [row("801", "VLADI", { hours: 30, state: "GA" }), row("669", "VINNIEV", { hours: 5 }), row("773", "VINNIEV"), row("550", "1")],
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

  it("shows three queues as tabs with their counts, and History as the last tab", async () => {
    board.value = response(true);
    const w = await mountPage();
    const tabs = w.findAll("[role=tab]").map((t) => t.text().replace(/\s+/g, " "));
    expect(tabs).toEqual(["All trucks 2", "Needs a load 2", "Needs attention 0", "History"]);
    await w.findAll("[role=tab]").at(-1)!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ queue: "history" });
    expect(w.find("[data-test=history]").exists()).toBe(true);
  });

  it("sorts by a column and keeps the sort in the URL, so a link reopens it", async () => {
    board.value = response(false);
    const w = await mountPage();
    // Soonest free first until somebody asks otherwise.
    expect(units(w)).toEqual(["773", "669", "801"]);
    await w.findAll("thead button").find((b) => b.text() === "Truck")!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ sort: "unit", dir: "asc" });
    expect(units(w)).toEqual(["669", "773", "801"]);
    const again = await mountPage("/assignments?sort=unit&dir=desc");
    expect(units(again)).toEqual(["801", "773", "669"]);
  });

  it("reopens a link's scope and fleet, and shows a primary filter in its trigger rather than as a chip", async () => {
    board.value = response(true);
    const w = await mountPage("/assignments?scope=all&fleet=VLADI");
    expect(units(w)).toEqual(["801"]);
    expect(w.text()).not.toContain("Clear all");
  });

  it("clears a narrowed board back to every truck in its scope, keeping the scope and the sort", async () => {
    board.value = response(true);
    const w = await mountPage("/assignments?scope=all&state=GA&within=48&sort=unit&dir=asc");
    expect(units(w)).toEqual(["801"]);
    const clear = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    await clear()!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ scope: "all", sort: "unit", dir: "asc" });
    expect(units(w)).toEqual(["669", "773", "801"]);
    expect(clear()).toBeUndefined();
  });

  it("shows the columns a link leaves in, never hiding the truck, and offers the column picker", async () => {
    board.value = response(true);
    const w = await mountPage("/assignments?hide=milesLeft,next,unit");
    const headers = w.findAll("thead th").map((th) => th.text().trim());
    expect(headers).toContain("Truck");
    expect(headers).toContain("Available");
    expect(headers).not.toContain("Miles left");
    expect(headers).not.toContain("Next load");
    // A link's own hidden-list wins, so the Live columns it does not hide show; the truck cannot be hidden.
    expect(headers).toContain("HOS");
    expect(w.findAll("button").find((b) => b.text().startsWith("Columns"))!.text()).toContain("2 hidden");
  });

  it("opens on the dispatchers' columns and the Warnings, the live ones one tick away in the picker", async () => {
    board.value = response(true);
    const w = await mountPage();
    const headers = w.findAll("thead th").map((th) => th.text().trim());
    expect(headers).toEqual(["Truck", "Driver", "Dispatcher", "Available", "Available in", "Miles left", "Status", "Warnings"]);
    expect(w.findAll("button").find((b) => b.text().startsWith("Columns"))!.text()).toContain("5 hidden");
  });

  it("saves the board's whole URL as a view, applies one by navigating, and names the one showing", async () => {
    board.value = response(true);
    savedViews.views = [{ table_id: "dispatch.board", name: "VLADI late", query: "scope=all&fleet=VLADI", updated_at: "2026-10-10T00:00:00Z" }];
    const w = await mountPage("/assignments?queue=late&sort=status&dir=asc&hide=milesLeft");
    expect(savedViews.table).toBe("dispatch.board");
    const menu = w.findComponent(SavedViewMenu);
    expect(menu.props("builtIns")).toEqual([]);
    menu.vm.$emit("save", "Late, by risk");
    await flushPromises();
    expect(savedViews.save).toHaveBeenCalledWith("Late, by risk", "queue=late&sort=status&dir=asc&hide=milesLeft");
    menu.vm.$emit("apply", "scope=all&fleet=VLADI");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ scope: "all", fleet: "VLADI" });
    expect(units(w)).toEqual(["801"]);
    expect(w.findComponent(SavedViewMenu).props("activeName")).toBe("VLADI late");
  });

  it("counts trucks per dispatcher, and a dispatcher's count is the filter", async () => {
    board.value = response(true);
    const w = await mountPage();
    const census = w.get("[aria-label='Trucks per dispatcher']").findAll("button");
    expect(census.map((b) => b.attributes("aria-label"))).toEqual([
      "Mine: 2 trucks",
      "All: 3 trucks, 3 empty now",
      "VINNIEV: 2 trucks, 2 empty now",
      "VLADI: 1 truck, 1 empty now",
      "Pool: 1 truck",
    ]);
    expect(census[0]!.attributes("aria-pressed")).toBe("true");
    await census[3]!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ scope: "all", fleet: "VLADI" });
    expect(units(w)).toEqual(["801"]);
    await w.get("[aria-label='Trucks per dispatcher']").findAll("button")[1]!.trigger("click");
    await flushPromises();
    expect(w.router.currentRoute.value.query).toEqual({ scope: "all" });
    expect(units(w)).toEqual(["773", "669", "801"]);
  });

  it("finds the trucks free in a state within a horizon, from a link", async () => {
    board.value = response(false);
    expect(units(await mountPage("/assignments?state=FL"))).toEqual(["773", "669"]);
    expect(units(await mountPage("/assignments?state=fl,ga&within=12"))).toEqual(["773", "669"]);
    expect(units(await mountPage("/assignments?within=0"))).toEqual(["773"]);
  });

  it("finds trucks near a city the board knows, and falls back to its state — saying so — for one it does not", async () => {
    board.value = response(false);
    expect(units(await mountPage("/assignments?near=LAKELAND|FL&radius=50"))).toEqual(["773", "669"]);
    const gone = await mountPage("/assignments?near=MACON|GA");
    expect(units(gone)).toEqual(["801"]);
    expect(gone.text()).toContain("No truck is free in that city any more");
  });

  /**
   * D-US8: the board pages — 197 trucks in production were one table. Twenty a page, the page in the
   * URL, a filter starting again at page 1. The board arriving after the page opened must not reset a
   * pasted page: the scope's default flips from All to My fleet when it lands.
   */
  describe("pages twenty trucks at a time", () => {
    const many = (): DispatchBoardResponse => ({
      ...response(true),
      rows: Array.from({ length: 45 }, (_, i) => row(String(1001 + i), "VINNIEV", { hours: i })),
    });

    it("shows trucks 21–40 on a pasted ?page=2, and keeps it when the board arrives after the page opened", async () => {
      board.value = null;
      const w = await mountPage("/assignments?page=2");
      board.value = many();
      await flushPromises();
      expect(units(w)).toEqual(Array.from({ length: 20 }, (_, i) => String(1021 + i)));
      expect(w.router.currentRoute.value.query).toEqual({ page: "2" });
      expect(w.text()).toContain("of 45");
    });

    it("goes back to page 1 when the search changes, even when the new set still reaches page 2", async () => {
      board.value = many();
      const w = await mountPage("/assignments?page=2");
      w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "10");
      await flushPromises();
      expect(w.router.currentRoute.value.query).toEqual({ search: "10" });
      expect(units(w)[0]).toBe("1001");
    });

    it("turns the page from the pager and writes it into the URL", async () => {
      board.value = many();
      const w = await mountPage();
      await w.findAll("button").find((b) => b.text() === "Next")!.trigger("click");
      await flushPromises();
      expect(w.router.currentRoute.value.query).toEqual({ page: "2" });
      expect(units(w)[0]).toBe("1021");
    });
  });
});
