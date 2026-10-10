import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { DispatchBoardRow } from "@silvicom/shared";

/**
 * The truck drawer (DISPATCH-BOARD-PLAN DB6). What it must hold:
 *   · the stops and the route are read for the ONE load in the drawer, and nothing is read for a truck
 *     with no load — the board polls every truck each minute, the route is a HERE call (D-TC5);
 *   · our ETA is the one with a verdict and a basis; McLeod's typed ETA appears only on a stop not yet
 *     reached, labelled as McLeod's reference (D-DB4) — never on a stop the truck already reached;
 *   · the four HOS clocks are all there, not just the one the row shows;
 *   · the way out goes to the truck's, the driver's and the load's own pages.
 */
const LOAD = "11111111-2222-4333-8444-000000000001";

const calls = vi.hoisted(() => ({ gets: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.gets.push(url);
    if (url.endsWith("/route")) {
      return {
        ok: true,
        data: {
          ok: true,
          data: {
            loadId: LOAD, covered: [], ahead: [], distanceMiles: 812.4, durationHours: 13.5, truckOnRoute: true,
            coveredMiles: 300.2, offRouteMiles: 0,
            fuelStops: [{ name: "Pilot 412", brand: "Pilot", address: null, city: "Joplin", state: "MO", zip: null, exit: null, lat: 37, lng: -94, milesAhead: 88.6 }],
            fuelNote: null, hazmatNotApplied: false,
          },
        },
      };
    }
    return {
      ok: true,
      data: {
        load: {
          id: LOAD,
          stops: [
            // Out of order on purpose: the drawer reads them by sequence, as the route runs.
            { id: "s2", seq: 2, kind: "dropoff", name: "Kroger DC", location_name: null, city: "Indianapolis", state: "IN",
              appointment_start: "2026-10-11T13:00:00Z", appointment_end: null, actual_arrival_at: null, arrived_at: null,
              eta_at: "2026-10-11T12:00:00Z", photos: [] },
            { id: "s1", seq: 1, kind: "pickup", name: "Tyson", location_name: "Tyson Springdale", city: "Springdale", state: "AR",
              appointment_start: "2026-10-10T08:00:00Z", appointment_end: "2026-10-10T10:00:00Z",
              actual_arrival_at: "2026-10-10T08:20:00Z", arrived_at: null, eta_at: "2026-10-10T07:00:00Z", photos: [] },
          ],
        },
      },
    };
  }),
}));

const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "description"],
};
const DispatchTruckDrawer = (await import("./DispatchTruckDrawer.vue")).default;

const stop = { kind: "dropoff", name: "Kroger DC", city: "Indianapolis", state: "IN", appointmentStart: null, appointmentEnd: null, arrivedAt: null, lat: 39.7, lng: -86.1 };
const loaded: DispatchBoardRow = {
  vehicleId: "v-773", unitNumber: "773", inShop: false, fleetCode: "VINNIEV",
  driver: { id: "d-1", name: "Dana Kelly" },
  hos: { status: "driving", driveRemainingMs: 4 * 3_600_000, shiftRemainingMs: 6 * 3_600_000, cycleRemainingMs: 40 * 3_600_000, breakRemainingMs: 2 * 3_600_000, fetchedAt: "2026-10-10T15:00:00Z" },
  position: null, fuelPercent: null,
  current: { loadId: LOAD, ref: "0012345", status: "in_transit", source: "mcleod", externalStatus: "P", customerName: "Kroger", dispatcherId: "vinniev", driverName: null, trailerUnit: null, nextStop: stop, lastStop: stop, stopsLeft: 1 },
  next: null,
  eta: { at: "2026-10-11T11:30:00Z", miles: 512, restAdded: true },
  onTime: "on_time", empties: { place: "Indianapolis, IN", at: "2026-10-11T13:00:00Z" },
  flags: { lateRisk: false, noNextLoad: true, emptyNow: false, hosLow: false, noGps: false },
};
const empty: DispatchBoardRow = { ...loaded, current: null, eta: null, onTime: "unknown", empties: null };

async function mountIt(row: DispatchBoardRow | null) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/vehicles/:id", name: "vehicle-detail", component: { template: "<div/>" } },
      { path: "/drivers/:id", name: "driver-detail", component: { template: "<div/>" } },
      { path: "/loads/:id", name: "load-detail", component: { template: "<div/>" } },
    ],
  });
  const w = mount(DispatchTruckDrawer, {
    props: { row, zone: "America/Chicago", dispatchers: [{ id: "vinniev", name: "Vinnie V" }] },
    global: { plugins: [VueQueryPlugin, router], stubs: { SlideOver: SlideOverStub } },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  calls.gets.length = 0;
});

describe("DispatchTruckDrawer", () => {
  it("reads the stops and the route for the one load it shows, and nothing for a truck with no load", async () => {
    await mountIt(loaded);
    expect([...calls.gets].sort()).toEqual([`/api/dispatch/loads/${LOAD}`, `/api/livemap/loads/${LOAD}/route`]);

    calls.gets.length = 0;
    const w = await mountIt(empty);
    expect(calls.gets).toEqual([]);
    expect(w.text()).toContain("Empty, no load on this truck.");
  });

  it("puts our ETA, with its basis, beside the verdict, and McLeod's typed ETA only on a stop not yet reached", async () => {
    const w = await mountIt(loaded);
    const ours = w.get("[data-testid=truck-our-eta]").text();
    expect(ours).toContain("On time");
    expect(ours).toContain("Our ETA to Indianapolis, IN: 10/11/2026 6:30 AM");
    expect(w.text()).toContain("512 mi by distance at 50 mph, including a 10-hour reset.");

    const stops = w.get("[data-testid=truck-stops]").findAll("li");
    expect(stops.map((s) => s.text().split("\n")[0])).toEqual([
      expect.stringContaining("Pickup · Tyson Springdale"),
      expect.stringContaining("Delivery · Kroger DC"),
    ]);
    expect(stops[0]!.text()).toContain("Arrived 10/10/2026 3:20 AM");
    expect(stops[0]!.text()).not.toContain("McLeod ETA");
    expect(w.findAll("[data-testid=truck-mcleod-eta]").map((e) => e.text())).toEqual([
      "McLeod ETA 10/11/2026 7:00 AM (typed in McLeod, for reference)",
    ]);
  });

  it("shows all four HOS clocks, not only the one the row shows", async () => {
    const w = await mountIt(loaded);
    const clocks = w.get("[data-testid=truck-hos-clocks]").findAll("dd").map((d) => d.text());
    expect(clocks).toEqual(["4h 00m", "6h 00m", "40h 00m", "2h 00m"]);
  });

  it("summarises the route as the miles still ahead and the next fuel stop", async () => {
    const w = await mountIt(loaded);
    expect(w.get("[data-testid=truck-route-summary]").text()).toBe(
      "812 mi pickup to delivery · 512 mi still ahead · about 13h 30m of driving",
    );
    expect(w.text()).toContain("Next fuel stop: Pilot 412, Joplin, MO, 89 mi ahead");
  });

  it("opens the truck's, the driver's and the load's own pages", async () => {
    const w = await mountIt(loaded);
    const links = Object.fromEntries(w.get("nav").findAll("a").map((a) => [a.text(), a.attributes("href")]));
    expect(links).toEqual({ "Truck page": "/vehicles/v-773", "Driver page": "/drivers/d-1", "Load page": `/loads/${LOAD}` });
  });
});
