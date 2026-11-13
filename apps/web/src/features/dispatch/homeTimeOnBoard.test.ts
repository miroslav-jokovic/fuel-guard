import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref, shallowRef } from "vue";
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { answerConfirm } from "@silvicom/ui/testing";
import type { BoardHomeTime, DispatchBoardResponse, DispatchBoardRow, HomeTimeListResponse, HomeTimePeriod } from "@silvicom/shared";

/**
 * Home time on the real Dispatch board page, behind a mocked API (HOME-TIME-PLAN §3.3, §3.4, step HT3):
 * what the row says (Available, the Warnings chips), the two clicks from a row to the form, the Home time
 * tab, and what the drawer does with a live period — for somebody who may mark home time and for
 * somebody who may only read it.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "dispatcher" }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("dispatcher"), { isAuthenticated: true, orgId: null });
  return { useSessionStore: () => Object.assign(s, { role: who.role }) };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>(["dispatch"])) }) };
});
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: computed(() => "America/Chicago") }) }));
vi.mock("@/features/dispatch/AssignmentHistory.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/composables/useSavedViews", () => ({
  useSavedViews: () => ({ views: { value: [] }, loading: { value: false }, saving: { value: false }, save: vi.fn(), remove: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
const board = shallowRef<DispatchBoardResponse | null>(null);
vi.mock("@/features/dispatch/useDispatchBoard", () => ({
  useDispatchBoardQuery: () => ({
    data: computed(() => board.value), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: () => {},
  }),
}));

const AssignmentsPage = (await import("@/pages/AssignmentsPage.vue")).default;

const NOW = "2026-11-13T15:00:00.000Z"; // 09:00 Central
const hours = (n: number) => new Date(Date.parse(NOW) + n * 3_600_000).toISOString();
const ANA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RAY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const T773 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T848 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const T900 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const P_ANA = "50000000-0000-4000-8000-00000000000a";
const P_RAY = "50000000-0000-4000-8000-00000000000b";

const flags = { lateRisk: false, noNextLoad: false, emptyNow: true, hosLow: false, noGps: false, warningUrgent: false, homeTimeUrgent: false };
const row = (unitNumber: string, vehicleId: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, coDriver: null, trailerId: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", milesLeft: null, warnings: [], noteMentions: [], homeTimes: [], flags,
  available: { place: null, city: "Lakeland", state: "FL", postalCode: "33801", lat: 28.04, lng: -81.95, at: NOW, basis: "now" },
  ...o,
});
const seat = (o: Partial<BoardHomeTime>): BoardHomeTime => ({
  periodId: P_ANA, driverId: ANA, driverName: "Ana Ruiz", state: "active", startAt: hours(-48), expectedReturnAt: "2026-11-18T14:00:00.000Z",
  disposition: "with_driver", chips: [], ...o,
});
const response = (): DispatchBoardResponse => ({
  generatedAt: NOW,
  rows: [
    // Home with her truck: Available says it, so no "home" chip.
    row("773", T773, {
      driver: { id: ANA, name: "Ana Ruiz" },
      homeTimes: [seat({})],
      available: { place: null, city: "Joliet", state: "IL", postalCode: "60431", lat: 41.5, lng: -88.1, at: "2026-11-18T14:00:00.000Z", basis: "home_time" },
      flags: { ...flags, emptyNow: false },
    }),
    // A team truck with one seat home and overdue: it still runs; the chip names him.
    row("848", T848, {
      driver: { id: SAM, name: "Sam Pool" }, coDriver: { id: BEN, name: "Ben Cole" },
      homeTimes: [seat({ periodId: P_RAY, driverId: BEN, driverName: "Ben Cole", state: "overdue", expectedReturnAt: hours(-28), disposition: "at_yard", chips: ["overdue"] })],
      flags: { ...flags, homeTimeUrgent: true },
    }),
    // Nobody home.
    row("900", T900, { driver: { id: RAY, name: "Ray Diaz" } }),
  ],
  scope: { linked: false, fleetCodes: [], dispatcherIds: [] },
  fleets: [{ code: "VINNIEV", dispatcherId: "vinniev" }],
  dispatchers: [],
  uncoveredCount: 0,
  hosAsOf: null,
});

const period = (o: Partial<HomeTimePeriod> = {}): HomeTimePeriod => ({
  id: P_ANA, driverId: ANA, driverName: "Ana Ruiz", vehicleId: T773, unitNumber: "773", disposition: "with_driver",
  startAt: hours(-48), expectedReturnAt: "2026-11-18T14:00:00.000Z", endAt: null, endReason: null, canceledAt: null, state: "active",
  markedByName: "Dana Dispatch", createdAt: hours(-48), updatedAt: hours(-48), ...o,
});
const overdue = period({ id: P_RAY, driverId: BEN, driverName: "Ben Cole", vehicleId: T848, unitNumber: "848", disposition: "at_yard", expectedReturnAt: hours(-28), state: "overdue" });
const list = (): HomeTimeListResponse => ({
  generatedAt: NOW,
  live: [overdue, period()],
  recent: [period({ id: "50000000-0000-4000-8000-00000000000c", driverId: RAY, driverName: "Ray Diaz", vehicleId: T900, unitNumber: "900", startAt: hours(-300), endAt: hours(-200), endReason: "load_evidence", state: "ended" })],
  settings: { returnDueHours: 24, overdueAfterHours: 2, truckLimitDays: 8 },
});
const drivers = [
  { driverId: ANA, driverName: "Ana Ruiz", vehicleId: T773, unitNumber: "773", lastDisposition: "with_driver" },
  { driverId: BEN, driverName: "Ben Cole", vehicleId: T848, unitNumber: "848", lastDisposition: null },
  { driverId: RAY, driverName: "Ray Diaz", vehicleId: T900, unitNumber: "900", lastDisposition: null },
];

let router: Router;
const mounted: VueWrapper[] = [];
async function render(path = "/assignments") {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: { template: "<div/>" } },
      { path: "/assignments", component: { template: "<div/>" } },
      { path: "/loads", name: "loads", component: { template: "<div/>" } },
      { path: "/loads/:id", name: "load-detail", component: { template: "<div/>" } },
      { path: "/vehicles/:id", name: "vehicle-detail", component: { template: "<div/>" } },
      { path: "/drivers/:id", name: "driver-detail", component: { template: "<div/>" } },
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
const body = () => document.body;
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const button = (label: string) => [...body().querySelectorAll("button")].find((b) => text(b) === label) as HTMLButtonElement | undefined;
const rowOf = (unit: string) => [...body().querySelectorAll("tbody tr")].find((tr) => text(tr).startsWith(unit))!;
/** A row's cells, each as its own words: a `<tr>`'s text runs its cells together with nothing between. */
const cells = (tr: Element) => [...tr.querySelectorAll("td")].map(text);
/** A block of stacked lines (a cell, a fact list) as its lines, for the same reason. */
const lines = (el: Element | null) => [...(el?.querySelectorAll("div, span, p, dt, dd") ?? [])].filter((n) => n.children.length === 0 || n.tagName === "DD").map(text).filter(Boolean);
const sent = (suffix: string) => apiFetch.mock.calls.filter((c) => String(c[0]).endsWith(suffix));
const homeTimeCalls = () => apiFetch.mock.calls.map((c) => `${(c[1] as { method?: string } | undefined)?.method ?? "GET"} ${String(c[0])}`).filter((p) => p.includes("/api/roster/home-time"));

beforeEach(() => {
  setActivePinia(createPinia());
  who.role = "dispatcher";
  board.value = response();
  toast.success.mockReset();
  toast.error.mockReset();
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/roster/home-time" && !init?.method) return { ok: true, status: 200, data: list() };
    if (path === "/api/roster/home-time/drivers") return { ok: true, status: 200, data: { drivers } };
    if (path.startsWith("/api/roster/home-time")) return { ok: true, status: 200, data: { period: period() } };
    return { ok: true, status: 200, data: { kinds: {}, notes: [], fuzzy: false, next: null, people: [] } };
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the row", () => {
  it("reads 'Home time until' the return, on the carrier's clock, where it read 'Now' — and only on the held truck", async () => {
    await render();
    expect(lines(rowOf("773").querySelectorAll("td")[3]!)).toEqual(["Home time", "11/18/2026 8:00 AM"]);
    expect(cells(rowOf("773"))[3]).toBe("Home timeuntil 11/18/2026 8:00 AM");
    expect(cells(rowOf("848"))[3]).toBe("Now");
    // …and Status says the same, not "Empty", which reads as "give it a load".
    expect(cells(rowOf("773"))[6]).toBe("Home time");
    expect(cells(rowOf("848"))[6]).toBe("Empty");
    expect(body().querySelectorAll("[data-testid=available-home-time]")).toHaveLength(1);
  });

  it("puts each seat's chips in Warnings, naming the seat on a team truck, and none where Available already says it", async () => {
    await render();
    const chips = (unit: string) => [...rowOf(unit).querySelectorAll("[data-board-home-time-chip]")].map(text);
    expect(chips("848")).toEqual(["Ben Cole: home time overdue 1 d 4 h"]);
    expect(chips("773")).toEqual([]);
    expect(chips("900")).toEqual([]);
  });

  it("marks the overdue row as needing attention, and counts it in that tab", async () => {
    await render();
    expect(rowOf("848").querySelector("[aria-label='Needs attention']")).not.toBeNull();
    expect(rowOf("773").querySelector("[aria-label='Needs attention']")).toBeNull();
    const tab = [...body().querySelectorAll("[role=tab]")].find((t) => text(t).startsWith("Needs attention"))!;
    expect(text(tab)).toBe("Needs attention 1");
  });
});

describe("two clicks from a row to the form", () => {
  it("opens the truck's drawer with home time first, then the form on that driver — one dialog, not two", async () => {
    await render();
    (rowOf("900").querySelector("button") as HTMLButtonElement).click();
    await flushPromises();
    const section = body().querySelector("[data-testid=truck-home-time]")!;
    expect(text(section)).toContain("Not on home time.");
    (button("Mark home time") as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ homeTime: RAY });
    expect(router.currentRoute.value.query.truck).toBeUndefined();
    expect(body().querySelector("[data-testid=truck-home-time]")).toBeNull();
    expect(body().querySelector("[data-testid=home-time-form]")).not.toBeNull();
    expect(text(body())).toContain("Ray Diaz · Truck 900");
  });

  it("says each seat's home time at full length on a team truck, with Open on the one that has a period", async () => {
    await render("/assignments?truck=848");
    const section = text(body().querySelector("[data-testid=truck-home-time]"));
    expect(section).toContain("Sam Pool · Not on home time.");
    expect(section).toContain("Ben Cole · Overdue: was due back 11/12/2026 5:00 AM.");
    expect([...body().querySelectorAll("[data-testid=truck-home-time] button")].map(text)).toEqual(["Mark home time", "Open"]);
  });

  it("offers no Mark button to somebody who only reads Dispatch, but still opens a period that exists", async () => {
    who.role = "auditor";
    await render("/assignments?truck=848");
    expect([...body().querySelectorAll("[data-testid=truck-home-time] button")].map(text)).toEqual(["Open"]);
  });
});

describe("the Home time tab", () => {
  it("counts the live periods on the tab and lists them overdue first, with the truck and who marked each", async () => {
    await render("/assignments?queue=home-time");
    const tab = [...body().querySelectorAll("[role=tab]")].find((t) => text(t).startsWith("Home time"))!;
    expect(text(tab)).toBe("Home time 2");
    const rows = [...body().querySelectorAll("tbody tr")].map(cells);
    expect(rows).toEqual([
      ["Ben Cole", "Overdue", "11/11/2026 9:00 AM", "11/12/2026 5:00 AM1 d 4 h ago", "848 · at the yard", "Dana Dispatch"],
      ["Ana Ruiz", "Home", "11/11/2026 9:00 AM", "11/18/2026 8:00 AMin 4 d 23 h", "773 · with the driver", "Dana Dispatch"],
    ]);
  });

  it("shows what ended lately on the other choice, with why it ended", async () => {
    await render("/assignments?queue=home-time&ht.show=recent");
    const rows = [...body().querySelectorAll("tbody tr")].map(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slice(0, 2)).toEqual(["Ray Diaz", "Ended"]);
    expect(rows[0]![4]).toBe("11/05/2026 1:00 AMEnded by the system: the driver was on a load");
  });

  it("opens the drawer on a driver search from Mark home time, then on the driver chosen", async () => {
    await render("/assignments?queue=home-time");
    (body().querySelector("[data-testid=home-time-mark]") as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.query.homeTime).toBe("new");
    expect(text(body())).toContain("Choose the driver who is going home.");
    await router.replace({ query: { ...router.currentRoute.value.query, homeTime: RAY } });
    await flushPromises();
    expect(body().querySelector("[data-testid=home-time-form]")).not.toBeNull();
  });

  it("has no Mark button for somebody who only reads Dispatch", async () => {
    who.role = "auditor";
    await render("/assignments?queue=home-time");
    expect(body().querySelector("[data-testid=home-time-mark]")).toBeNull();
    expect([...body().querySelectorAll("tbody tr")]).toHaveLength(2);
  });
});

describe("the drawer on a live period", () => {
  it("shows when she left, when she is due, where the truck is and who marked it", async () => {
    await render(`/assignments?homeTime=${ANA}`);
    const facts = body().querySelector("[data-testid=home-time-facts]")!;
    expect(Object.fromEntries([...facts.querySelectorAll("dt")].map((dt, i) => [text(dt), text(facts.querySelectorAll("dd")[i]!)]))).toEqual({
      Left: "11/11/2026 9:00 AM",
      Returns: "11/18/2026 8:00 AM — in 4 d 23 h",
      Truck: "773 — with the driver",
      "Marked by": "Dana Dispatch, 11/11/2026 9:00 AM",
    });
    expect([...body().querySelectorAll("[data-testid=home-time-actions] button")].map(text)).toEqual([
      "Back from home time", "Change", "Truck is back at the yard", "Cancel home time",
    ]);
  });

  it("ends the period in one click, says so, and closes", async () => {
    await render(`/assignments?homeTime=${ANA}`);
    (button("Back from home time") as HTMLButtonElement).click();
    await flushPromises();
    expect(sent(`/${P_ANA}/end`)).toHaveLength(1);
    expect(sent(`/${P_ANA}/end`)[0]![1]).toMatchObject({ method: "POST" });
    expect(toast.success).toHaveBeenCalledWith("Ana Ruiz is back from home time");
    expect(router.currentRoute.value.query.homeTime).toBeUndefined();
  });

  it("sends the truck back to the yard as a change of that one fact", async () => {
    await render(`/assignments?homeTime=${ANA}`);
    (button("Truck is back at the yard") as HTMLButtonElement).click();
    await flushPromises();
    expect(sent(`/${P_ANA}`)[0]![1]).toMatchObject({ method: "PATCH", body: { disposition: "at_yard" } });
  });

  it("asks before canceling, and cancels nothing on No", async () => {
    const asked = answerConfirm(false);
    await render(`/assignments?homeTime=${ANA}`);
    (button("Cancel home time") as HTMLButtonElement).click();
    await flushPromises();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]![0].title).toBe("Cancel Ana Ruiz's home time?");
    expect(sent("/cancel")).toEqual([]);
  });

  it("cancels on Yes", async () => {
    answerConfirm(true);
    await render(`/assignments?homeTime=${ANA}`);
    (button("Cancel home time") as HTMLButtonElement).click();
    await flushPromises();
    expect(sent(`/${P_ANA}/cancel`)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith("Home time canceled");
  });

  it("says why the API refused, and stays open", async () => {
    await render(`/assignments?homeTime=${ANA}`);
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: false, status: 409, error: { code: "conflict", message: "This home time was already ended or canceled. Refresh to see it." } }
        : path === "/api/roster/home-time/drivers" ? { ok: true, status: 200, data: { drivers } } : { ok: true, status: 200, data: list() });
    (button("Back from home time") as HTMLButtonElement).click();
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("Could not end the home time", "This home time was already ended or canceled. Refresh to see it.");
    expect(router.currentRoute.value.query.homeTime).toBe(ANA);
  });

  it("shows the facts and no buttons to somebody who only reads Dispatch", async () => {
    who.role = "auditor";
    await render(`/assignments?homeTime=${ANA}`);
    expect(body().querySelector("[data-testid=home-time-facts]")).not.toBeNull();
    expect(body().querySelector("[data-testid=home-time-actions]")).toBeNull();
    expect(body().querySelector("[data-testid=home-time-form]")).toBeNull();
  });

  it("offers Reopen on a driver whose last period ended, beside the form for a new one", async () => {
    await render(`/assignments?homeTime=${RAY}`);
    expect(text(body().querySelector("[data-testid=home-time-last]"))).toContain("Ended by the system: the driver was on a load.");
    expect(body().querySelector("[data-testid=home-time-form]")).not.toBeNull();
    (button("Reopen it — the driver is still home") as HTMLButtonElement).click();
    await flushPromises();
    expect(sent("/50000000-0000-4000-8000-00000000000c/reopen")).toHaveLength(1);
  });
});

describe("what it asks", () => {
  it("reads the list once for the page — the tab's badge and the drawer share it — and the drivers only when the drawer opens", async () => {
    await render();
    expect(homeTimeCalls()).toEqual(["GET /api/roster/home-time"]);
    await router.push({ query: { homeTime: ANA } });
    await flushPromises();
    expect(homeTimeCalls()).toEqual(["GET /api/roster/home-time", "GET /api/roster/home-time/drivers"]);
  });
});
