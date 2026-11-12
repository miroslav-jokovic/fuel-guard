import { describe, expect, it } from "vitest";
import type { DispatchBoardRow } from "@silvicom/shared";
import { boardNoteSummary, boardNoteTargets, boardNoteUnitsWords } from "./boardNotes";

/**
 * Which units one Dispatch Board row's notes are about, and what its one Notes cell counts
 * (UNIT-NOTES-PLAN D-UN12, §6 UN6). Mounted on the board: `boardNotesOnBoard.test.ts`.
 */
const flags = { lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false, warningUrgent: false };
const load = { loadId: "l", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P", customerName: null,
  dispatcherId: null, driverName: null, trailerUnit: "3152", nextStop: null, lastStop: null, stopsLeft: 1 };
const row = (o: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  vehicleId: "veh-773", unitNumber: "773", inShop: false, fleetCode: "VINNIEV", driver: null, coDriver: null, trailerId: null,
  hos: null, position: null, fuelPercent: null, current: null, next: null, eta: null, onTime: "unknown", available: null,
  milesLeft: null, warnings: [], flags, ...o,
});
const ana = { id: "drv-1", name: "Ana Ruiz" };
const ben = { id: "drv-2", name: "Ben Okafor" };

describe("the units a board row's notes drawer holds", () => {
  it("holds a solo truck's truck, driver and the current load's trailer, in that order", () => {
    expect(boardNoteTargets(row({ driver: ana, trailerId: "trl-3152", current: load }))).toEqual([
      { kind: "vehicle", id: "veh-773", label: "773" },
      { kind: "driver", id: "drv-1", label: "Ana Ruiz" },
      { kind: "trailer", id: "trl-3152", label: "3152" },
    ]);
  });

  it("holds both seats of a team, the first seat first", () => {
    const kinds = boardNoteTargets(row({ driver: ana, coDriver: ben })).map((t) => `${t.kind}:${t.id}`);
    expect(kinds).toEqual(["vehicle:veh-773", "driver:drv-1", "driver:drv-2"]);
  });

  it("holds only the truck when nobody drives it and it pulls nothing", () => {
    expect(boardNoteTargets(row())).toEqual([{ kind: "vehicle", id: "veh-773", label: "773" }]);
  });

  it("holds one driver when the pairing names the same person in both seats", () => {
    expect(boardNoteTargets(row({ driver: ana, coDriver: ana })).filter((t) => t.kind === "driver")).toHaveLength(1);
  });

  it("holds a trailer by its id even when the load names no trailer number", () => {
    expect(boardNoteTargets(row({ trailerId: "trl-9" })).at(-1)).toEqual({ kind: "trailer", id: "trl-9", label: undefined });
  });
});

describe("the board row's one Notes cell", () => {
  const targets = boardNoteTargets(row({ driver: ana, coDriver: ben, trailerId: "trl-3152", current: load }));

  it("counts every note on the row's units together and ages them by the newest", () => {
    const s = boardNoteSummary(targets, {
      vehicle: { "veh-773": { count: 3, lastAt: "2026-11-09T12:00:00+00:00" } },
      driver: { "drv-2": { count: 1, lastAt: "2026-11-10T08:00:00Z" }, "drv-9": { count: 7, lastAt: "2026-11-11T08:00:00Z" } },
      trailer: { "trl-3152": { count: 2, lastAt: "2026-11-01T00:00:00Z" } },
    });
    // drv-9 is somebody else's driver: not on this row, not counted.
    expect(s).toEqual({ count: 6, lastAt: "2026-11-10T08:00:00Z" });
  });

  it("compares the newest by instant, not by text: Postgres's fraction and +00:00 against a browser's Z", () => {
    // Half a second later, but "." sorts before "Z" as text.
    const s = boardNoteSummary(targets, {
      vehicle: { "veh-773": { count: 1, lastAt: "2026-11-10T08:30:00.5+00:00" } },
      trailer: { "trl-3152": { count: 1, lastAt: "2026-11-10T08:30:00Z" } },
    });
    expect(s?.lastAt).toBe("2026-11-10T08:30:00.5+00:00");
  });

  it("has no summary — the quiet Add — when none of the row's units has a note", () => {
    expect(boardNoteSummary(targets, {})).toBeUndefined();
    expect(boardNoteSummary(targets, { vehicle: { "veh-773": { count: 0, lastAt: "2026-11-10T09:00:00Z" } } })).toBeUndefined();
  });

  it("names the units to a screen reader the way the board reads them", () => {
    expect(boardNoteUnitsWords(targets)).toBe("truck 773, Ana Ruiz, Ben Okafor, trailer 3152");
  });
});
