import { describe, it, expect } from "vitest";
import type { DispatchBoardRow, DispatchScope } from "@silvicom/shared";
import { sortRows } from "@/lib/sort";
import { boardSortValue, filterBoard, durationWords, gpsAgeWords, POOL_OPTION, NO_FLEET_OPTION, type BoardFilter } from "./dispatchBoardView";

const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false };
const row = (unitNumber: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", empties: null, flags, ...o,
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

  it("puts the trucks that will miss their appointment first, and the ones with no verdict last", () => {
    const rows = [
      row("on", { current: load(null), onTime: "on_time" }),
      row("none", { current: null }),
      row("late", { current: load(null), onTime: "late" }),
      row("risk", { current: load(null), onTime: "at_risk" }),
    ];
    expect(sorted(rows, "onTime")).toEqual(["late", "risk", "on", "none"]);
  });

  it("sorts HOS by the time left, not by the words it is shown in", () => {
    // As text, "10h 00m" sorts before "2h 05m"; as time it is the other way round.
    const rows = [row("ten", { hos: hos(10 * 3_600_000) }), row("two", { hos: hos(2 * 3_600_000 + 5 * 60_000) }), row("unknown")];
    expect(sorted(rows, "hos")).toEqual(["two", "ten", "unknown"]);
  });
});
