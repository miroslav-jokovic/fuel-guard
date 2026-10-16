import { describe, it, expect } from "vitest";
import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";
import { boardDoor, boardRows, fleetNow, queueLabel } from "./boardCounts";
import { BOARD_QUEUES, filterBoard } from "./dispatchBoardView";

const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, warningUrgent: false };
const load = { loadId: "l", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P", customerName: "Viking Packing",
  dispatcherId: "vinniev", driverName: null, trailerUnit: null, nextStop: null, lastStop: null, stopsLeft: 1 };
const row = (unitNumber: string, o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId: `v-${unitNumber}`, unitNumber, inShop: false, fleetCode: "VINNIEV", driver: null, hos: null, position: null,
  fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", available: null, milesLeft: null, warnings: [], flags, ...o,
});

const board = (rows: DispatchBoardRow[]): DispatchBoardResponse => ({
  generatedAt: "2026-10-12T15:00:00.000Z",
  rows,
  // A LINKED caller — the case where the board would open on My fleet, so the card must say All.
  scope: { linked: true, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] },
  fleets: [], dispatchers: [], uncoveredCount: 3, hosAsOf: null,
});

const B = board([
  row("773", { current: load }),
  row("801", { fleetCode: "VLADI", current: load, flags: { ...flags, lateRisk: true } }),
  row("698", { flags: { ...flags, emptyNow: true } }),
  row("660", { inShop: true }),
  // The parked pool: a late flag on a truck the board's All leaves out. Counting it would be the
  // drift between card and board this file exists to rule out.
  row("550", { fleetCode: "1", flags: { ...flags, lateRisk: true, emptyNow: true } }),
]);

describe("the Operations tab's board counts", () => {
  it("count exactly the rows the board shows behind each door, parked pool excluded", () => {
    const all = { mine: false, fleet: "", dispatcher: "", search: "" };
    for (const q of BOARD_QUEUES) {
      expect(boardRows(B, q.value).length, q.value).toBe(filterBoard(B.rows, B.scope, { ...all, queue: q.value }).length);
    }
    expect(boardRows(B, "late").map((r) => r.unitNumber)).toEqual(["801"]);
  });

  it("partition the board into hauling, empty and in the shop", () => {
    expect(fleetNow(B)).toEqual({ total: 4, loaded: 2, empty: 1, inShop: 1 });
  });

  it("open the board on All, whatever the caller's own scope would default to", () => {
    expect(boardDoor()).toBe("/assignments?scope=all");
    expect(boardDoor("hos-low")).toBe("/assignments?scope=all&queue=hos-low");
  });

  it("name a queue with the board's own label", () => {
    expect(queueLabel("no-gps")).toBe("No GPS");
  });
});
