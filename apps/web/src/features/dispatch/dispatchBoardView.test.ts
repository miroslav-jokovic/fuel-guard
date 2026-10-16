import { describe, it, expect } from "vitest";
import type { DispatchBoardRow, DispatchScope } from "@silvicom/shared";
import { sortRows } from "@silvicom/ui";
import {
  availablePlace,
  availableTone,
  boardSortValue,
  filterBoard,
  fleetCensus,
  durationWords,
  gpsAgeWords,
  milesLeftWords,
  warningWords,
  POOL_OPTION,
  NO_FLEET_OPTION,
  type BoardFilter,
} from "./dispatchBoardView";

const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, maintenanceOverdue: false };
const row = (unitNumber: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", available: null, milesLeft: null, warnings: [], flags, ...o,
});
const load = (dispatcherId: string | null) => ({
  loadId: "l", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P", customerName: "Viking Packing",
  dispatcherId, driverName: null, trailerUnit: null, nextStop: null, lastStop: null, stopsLeft: 1,
});
const scope: DispatchScope = { linked: true, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] };
const all: BoardFilter = { mine: false, fleet: "", dispatcher: "", queue: "all", search: "" };
const units = (rows: DispatchBoardRow[]) => rows.map((r) => r.unitNumber);

const ROWS = [
  row("773", { current: load("vinniev") }),
  row("669", { current: load("asen") }), // Vinnie's truck, Asen moving it
  row("698", { fleetCode: "VLADI", current: load("vinniev") }), // Vladi's truck, Vinnie moving it
  row("801", { fleetCode: "VLADI", current: load("asen"), flags: { ...flags, lateRisk: true } }),
  row("550", { fleetCode: "1" }), // the parked pool
  row("990", { fleetCode: null }),
];

describe("filterBoard", () => {
  it("My fleet is my fleet's trucks plus any truck on a load I dispatch — two axes, never merged", () => {
    expect(units(filterBoard(ROWS, scope, { ...all, mine: true }))).toEqual(["773", "669", "698"]);
  });

  it("All leaves the parked '1' pool out until it is asked for by name", () => {
    expect(units(filterBoard(ROWS, scope, all))).toEqual(["773", "669", "698", "801", "990"]);
    expect(units(filterBoard(ROWS, scope, { ...all, fleet: POOL_OPTION }))).toEqual(["550"]);
    expect(units(filterBoard(ROWS, scope, { ...all, fleet: NO_FLEET_OPTION }))).toEqual(["990"]);
  });

  it("narrows by fleet, by the load's dispatcher, by queue and by search", () => {
    expect(units(filterBoard(ROWS, scope, { ...all, fleet: "VLADI" }))).toEqual(["698", "801"]);
    expect(units(filterBoard(ROWS, scope, { ...all, dispatcher: "asen" }))).toEqual(["669", "801"]);
    expect(units(filterBoard(ROWS, scope, { ...all, queue: "late" }))).toEqual(["801"]);
    expect(units(filterBoard(ROWS, scope, { ...all, search: "77" }))).toEqual(["773"]);
  });
});

const NOW = new Date("2026-10-09T20:00:00Z");
const free = (hours: number, state = "FL", lat = 28.04, lng = -81.95): DispatchBoardRow["available"] => ({
  place: null, city: "Lakeland", state, postalCode: "33801", lat, lng,
  at: new Date(NOW.getTime() + hours * 3_600_000).toISOString(), basis: "appointment",
});

describe("filterBoard — where and when a truck is free (D-DBV3)", () => {
  const rows = [
    row("fl-now", { available: free(0) }),
    row("fl-day", { available: free(20) }),
    row("ga-week", { available: free(150, "GA", 32.08, -81.09) }),
    row("shop", { inShop: true, available: free(0) }),
    row("nowhere", { available: null }),
  ];
  const near = (f: Partial<NonNullable<BoardFilter["available"]>>) =>
    units(filterBoard(rows, scope, { ...all, available: { states: [], near: null, withinHours: null, ...f } }, NOW));

  it("matches a state, a horizon from the board's clock, and both together", () => {
    expect(near({ states: ["FL"] })).toEqual(["fl-now", "fl-day"]);
    expect(near({ withinHours: 24 })).toEqual(["fl-now", "fl-day"]);
    expect(near({ withinHours: 0 })).toEqual(["fl-now"]);
    expect(near({ states: ["GA"], withinHours: 24 })).toEqual([]);
  });
  it("matches a radius around a point, and never a truck in the shop", () => {
    expect(near({ near: { lat: 28.54, lng: -81.38, radiusMiles: 60 } })).toEqual(["fl-now", "fl-day"]);
    expect(near({})).toEqual(["fl-now", "fl-day", "ga-week", "shop", "nowhere"]);
  });
  it("searches the available city, state and ZIP and the fleet code too", () => {
    expect(units(filterBoard(rows, scope, { ...all, search: "33801" }, NOW))).toEqual(["fl-now", "fl-day", "ga-week", "shop"]);
    expect(units(filterBoard([row("1", { fleetCode: "KANE" })], scope, { ...all, search: "kane" }, NOW))).toEqual(["1"]);
  });
});

describe("the dispatchers' numbers and colours", () => {
  it("counts trucks per fleet and how many are empty now", () => {
    const census = fleetCensus([
      row("a", { fleetCode: "KANE", flags: { ...flags, emptyNow: true } }),
      row("b", { fleetCode: "KANE" }),
      row("c", { fleetCode: null }),
    ]);
    expect(census.get("KANE")).toEqual({ trucks: 2, empty: 1 });
    expect(census.get(null)).toEqual({ trucks: 1, empty: 0 });
  });
  it("colours Available red when free now or past, amber within a day, green later, and not at all in the shop", () => {
    expect(availableTone(row("x", { available: free(-3) }), NOW)).toBe("danger");
    expect(availableTone(row("x", { available: free(0) }), NOW)).toBe("danger");
    expect(availableTone(row("x", { available: free(23) }), NOW)).toBe("warning");
    expect(availableTone(row("x", { available: free(25) }), NOW)).toBe("success");
    expect(availableTone(row("x", { inShop: true, available: free(25) }), NOW)).toBe("neutral");
    expect(availableTone(row("x", { available: null }), NOW)).toBe("neutral");
  });
  it("words the place with its ZIP and the miles as an estimate", () => {
    expect(availablePlace(row("x", { available: free(1) }))).toBe("Lakeland, FL 33801");
    expect(milesLeftWords(1412)).toBe("≈ 1,412 mi");
    expect(milesLeftWords(null)).toBe("—");
  });
});

describe("warningWords — the dispatchers' board's chips (D-DBV5)", () => {
  const w = (o: Partial<Parameters<typeof warningWords>[0]>) => warningWords({ unit: "truck", kind: "annual", verdict: "due", dueOn: null, milesLeft: null, ...o });
  it("says a date, a mileage either way, a repair order, and names the trailer's", () => {
    expect(w({ verdict: "overdue", dueOn: "2026-09-30" })).toBe("Annual overdue 09/30/2026");
    expect(w({ kind: "six_month", unit: "trailer", dueOn: "2026-11-01" })).toBe("Trailer 6-month due 11/01/2026");
    expect(w({ kind: "oil", milesLeft: 1133 })).toBe("Oil in 1,133 mi");
    expect(w({ kind: "oil", verdict: "overdue", milesLeft: -5062 })).toBe("Oil 5,062 mi over");
    expect(w({ kind: "repair_order" })).toBe("Repair order open");
  });
});

describe("words", () => {
  it("says a duration and a GPS age the way the board does", () => {
    expect(durationWords(5 * 3_600_000 + 12 * 60_000)).toBe("5h 12m");
    expect(durationWords(45 * 60_000)).toBe("45m");
    expect(durationWords(null)).toBe("—");
    expect(gpsAgeWords(20)).toBe("now");
    expect(gpsAgeWords(600)).toBe("10 min");
    expect(gpsAgeWords(3 * 3600)).toBe("3 h");
    expect(gpsAgeWords(null)).toBe("no fix");
  });
});

describe("boardSortValue", () => {
  const hos = (driveRemainingMs: number) =>
    ({ status: "driving", driveRemainingMs, shiftRemainingMs: 14 * 3_600_000, cycleRemainingMs: 70 * 3_600_000, breakRemainingMs: 8 * 3_600_000, fetchedAt: "" }) as DispatchBoardRow["hos"];
  const sorted = (rows: DispatchBoardRow[], key: string) => units(sortRows(rows, { key, dir: "asc" }, boardSortValue));

  it("sorts Status by what needs a dispatcher: empty, late, at risk, on time, no verdict, the shop last", () => {
    const rows = [
      row("on", { current: load(null), onTime: "on_time" }),
      row("shop", { inShop: true }),
      row("unknown", { current: load(null), onTime: "unknown" }),
      row("empty", { current: null }),
      row("late", { current: load(null), onTime: "late" }),
      row("risk", { current: load(null), onTime: "at_risk" }),
    ];
    expect(sorted(rows, "status")).toEqual(["empty", "late", "risk", "on", "unknown", "shop"]);
  });

  it("sorts HOS by the time left, not by the words it is shown in", () => {
    // As text, "10h 00m" sorts before "2h 05m"; as time it is the other way round.
    const rows = [row("ten", { hos: hos(10 * 3_600_000) }), row("two", { hos: hos(2 * 3_600_000 + 5 * 60_000) }), row("unknown")];
    expect(sorted(rows, "hos")).toEqual(["two", "ten", "unknown"]);
  });
});
