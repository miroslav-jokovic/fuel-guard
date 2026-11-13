import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref, shallowRef } from "vue";
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";

/**
 * The Dispatch Board's Notes column (UNIT-NOTES-PLAN D-UN12, §6 UN6), on the real board page with the
 * real notes pieces behind a mocked API: ONE column per row, after Warnings, counting the truck's, the
 * drivers' and the trailer's notes together; a click opens ONE drawer holding every unit on the row
 * (and not the truck's drawer under it); the three kinds asked in ONE call, again when the board's rows
 * are rebuilt; and nothing at all for a viewer without the `notes` surface — the driver role only, since UN9 (D-UN4).
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("admin"), { isAuthenticated: true, orgId: null });
  return { useSessionStore: () => Object.assign(s, { role: who.role }) };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: computed(() => "America/Chicago") }) }));
vi.mock("@/features/dispatch/AssignmentHistory.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/features/dispatch/DispatchTruckDrawer.vue", () => ({
  default: { name: "DispatchTruckDrawer", props: ["row"], template: "<div data-test='truck-drawer'>{{ row ? row.unitNumber : 'closed' }}</div>" },
}));
vi.mock("@/composables/useSavedViews", () => ({
  useSavedViews: () => ({ views: { value: [] }, loading: { value: false }, saving: { value: false }, save: vi.fn(), remove: vi.fn() }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
const board = shallowRef<DispatchBoardResponse | null>(null);
const boardLoading = ref(false);
vi.mock("@/features/dispatch/useDispatchBoard", () => ({
  useDispatchBoardQuery: () => ({
    data: computed(() => board.value), isLoading: boardLoading, isError: ref(false), error: ref(null), isFetching: ref(false), refetch: () => {},
  }),
}));

const AssignmentsPage = (await import("@/pages/AssignmentsPage.vue")).default;

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TRL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, warningUrgent: false };
const load = { loadId: "l-1", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P", customerName: null,
  dispatcherId: null, driverName: null, trailerUnit: "3152", nextStop: null, lastStop: null, stopsLeft: 1 };
const row = (unitNumber: string, vehicleId: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, coDriver: null, trailerId: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", milesLeft: null, warnings: [], noteMentions: [], flags,
  available: { place: null, city: "Lakeland", state: "FL", postalCode: "33801", lat: 28.04, lng: -81.95, at: "2026-11-11T18:00:00Z", basis: "now" },
  ...o,
});
const response = (generatedAt = "2026-11-11T18:00:00Z"): DispatchBoardResponse => ({
  generatedAt,
  rows: [
    // A team truck on a load with a trailer: four units, one cell.
    row("773", VEH, { driver: { id: ANA, name: "Ana Ruiz" }, coDriver: { id: BEN, name: "Ben Okafor" }, trailerId: TRL, current: load }),
    // Nobody in it, nothing behind it: just the truck.
    row("669", "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  ],
  scope: { linked: false, fleetCodes: [], dispatcherIds: [] },
  fleets: [{ code: "VINNIEV", dispatcherId: "vinniev" }],
  dispatchers: [],
  uncoveredCount: 0,
  hosAsOf: null,
});

let router: Router;
const mounted: VueWrapper[] = [];
async function render(path = "/assignments") {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/assignments", component: { template: "<div/>" } },
      { path: "/loads", name: "loads", component: { template: "<div/>" } },
      { path: "/loads/:id", name: "load-detail", component: { template: "<div/>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(AssignmentsPage) });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]], stubs: { RouterLink: RouterLinkStub } } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const columnKeys = (w: VueWrapper) => (w.findComponent({ name: "DataTable" }).props("columns") as { key: string }[]).map((c) => c.key);
const notesCalls = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith("/api/notes"));
const summaryCalls = () => notesCalls().filter((p) => p.startsWith("/api/notes/summary"));
const cellOf = (w: VueWrapper, unit: string) => w.findAll("[data-board-notes-cell]").find((c) => c.attributes("aria-label")!.includes(`truck ${unit}`))!;

beforeEach(() => {
  setActivePinia(createPinia());
  who.role = "admin";
  board.value = response();
  boardLoading.value = false;
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T18:00:00Z"));
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/notes/summary")) {
      return { ok: true, status: 200, data: { kinds: {
        vehicle: { [VEH]: { count: 3, lastAt: "2026-11-09T12:00:00+00:00" } },
        driver: { [BEN]: { count: 1, lastAt: "2026-11-10T08:00:00+00:00" } },
        trailer: { [TRL]: { count: 2, lastAt: "2026-11-01T00:00:00+00:00" } },
      } } };
    }
    return { ok: true, status: 200, data: { notes: [], fuzzy: false, next: null, people: [] } };
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the Dispatch Board's Notes column", () => {
  it("is one column, right after Warnings, counting the truck's, both drivers' and the trailer's notes together", async () => {
    const w = await render();
    const keys = columnKeys(w);
    expect(keys.filter((k) => k === "notes")).toHaveLength(1);
    expect(keys.indexOf("notes")).toBe(keys.indexOf("warnings") + 1);
    // 3 on the truck + 1 on Ben + 2 on the trailer, aged by Ben's (the newest): a day before the clock.
    expect(cellOf(w, "773").text().replace(/\s+/g, " ")).toBe("6 1 d ago");
    expect(cellOf(w, "669").text()).toBe("Add");
    // The sidebar's Notes icon marks the row with notes, not the empty one.
    expect(cellOf(w, "773").find("[data-notes-cell-icon]").exists()).toBe(true);
    expect(cellOf(w, "669").find("[data-notes-cell-icon]").exists()).toBe(false);
  });

  it("asks for the three kinds in ONE call for the whole board", async () => {
    await render();
    expect(summaryCalls()).toEqual(["/api/notes/summary?kinds=vehicle,driver,trailer"]);
  });

  it("opens ONE drawer holding every unit on the row, through the URL, and not the truck's drawer", async () => {
    const w = await render();
    await cellOf(w, "773").trigger("click");
    await flushPromises();
    const q = router.currentRoute.value.query;
    expect(q.notes).toBe(`vehicle:${VEH},driver:${ANA},driver:${BEN},trailer:${TRL}`);
    expect(q.truck).toBeUndefined();
    expect(w.find("[data-test='truck-drawer']").text()).toBe("closed");
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
    expect(document.body.textContent).toContain("Notes · Truck 773 · Ana Ruiz · Ben Okafor · Trailer 3152");
  });

  it("asks for the counts again when the board's rows are rebuilt, and not on their first load", async () => {
    board.value = null;
    boardLoading.value = true;
    const w = await render();
    expect(summaryCalls()).toHaveLength(1);
    // The first rows, built half a minute before the browser's clock: not a refresh — the counts are
    // already being asked for alongside them.
    board.value = response("2026-11-11T17:59:30Z");
    boardLoading.value = false;
    await flushPromises();
    expect(summaryCalls()).toHaveLength(1);
    board.value = response("2026-11-11T18:01:00Z"); // the minute's poll brought rebuilt rows
    await flushPromises();
    expect(summaryCalls()).toHaveLength(2);
    expect(w.exists()).toBe(true);
  });

  it("is not there at all — not in the table, not in the picker, nothing asked — without the notes surface", async () => {
    who.role = "driver"; // the one role the `notes` surface is never on for (D-UN4)
    const w = await render();
    expect(columnKeys(w)).toContain("warnings");
    expect(columnKeys(w)).not.toContain("notes");
    expect(w.find("[data-board-notes-cell]").exists()).toBe(false);
    expect(w.text()).not.toMatch(/\bNotes\b/);
    expect(notesCalls()).toEqual([]);
  });

  it("opens the merged drawer from a pasted link", async () => {
    await render(`/assignments?notes=vehicle:${VEH},trailer:${TRL}`);
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
  });
});

/**
 * The Warnings cell's note chips (UNIT-NOTES-PLAN D-UN18, owner 2026-11-12): a note that names the row's
 * truck, a seat or its trailer is a chip under the due items; the chip opens the row's drawer ON that
 * note — with the unit the note was written on, when it is another — and the Resolve icon takes it off,
 * at once here, through the API.
 */
describe("the Warnings cell's note chips", () => {
  const MARCUS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const NOTE = "99999999-9999-4999-8999-999999999999";
  const mention = { noteId: NOTE, kind: "vehicle" as const, subjectId: VEH, at: "2026-11-11T15:00:00+00:00", authorName: "Dana",
    noteKind: "driver" as const, noteSubjectId: MARCUS, noteLabel: "Marcus Hill" };
  const withChip = () => {
    const r = response();
    r.rows[0] = { ...r.rows[0]!, noteMentions: [mention] };
    return r;
  };
  const chip = () => document.body.querySelector("[data-board-note-chip]");

  it("shows a chip in Warnings for a note that names the truck, and none on the row without one", async () => {
    board.value = withChip();
    await render();
    const chips = [...document.body.querySelectorAll("[data-board-note-chip]")];
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent!.replace(/\s+/g, " ").trim()).toBe("Note · Dana · 11/11");
  });

  it("opens the row's drawer on the note, holding the unit it was written on as well", async () => {
    board.value = withChip();
    await render();
    (document.body.querySelector("[data-board-note-open]") as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.query.note).toBe(NOTE);
    expect(String(router.currentRoute.value.query.notes)).toBe(
      `vehicle:${VEH},driver:${ANA},driver:${BEN},trailer:${TRL},driver:${MARCUS}`,
    );
    // The row's own click (the truck's drawer) did not fire under it.
    expect(document.body.querySelector("[data-test='truck-drawer']")?.textContent).toBe("closed");
  });

  it("resolves through the API for that note and unit, and the chip goes at once", async () => {
    board.value = withChip();
    await render();
    (document.body.querySelector("[data-board-note-resolve]") as HTMLButtonElement).click();
    await flushPromises();
    const sent = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/units/resolve"));
    expect(sent?.[0]).toBe(`/api/notes/${NOTE}/units/resolve`);
    expect(sent?.[1]).toMatchObject({ method: "POST", body: { kind: "vehicle", subjectId: VEH } });
    expect(chip()).toBeNull();
  });

  it("puts the chip back when the API refuses the resolve", async () => {
    board.value = withChip();
    await render();
    apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/units/resolve") ? { ok: false, status: 500, error: { code: "db_error", message: "boom" } } : { ok: true, status: 200, data: { kinds: {}, notes: [], people: [] } });
    (document.body.querySelector("[data-board-note-resolve]") as HTMLButtonElement).click();
    await flushPromises();
    expect(chip()).not.toBeNull();
  });
});
