import { describe, it, expect } from "vitest";
import { parseDriverCurrentTrucks } from "./index.js";

/** Every id in these fixtures is a truck and a driver we carry unless a test says otherwise. */
const all = { isTruck: () => true, isDriver: () => true };
const row = (vehicle: string, driver: string, startTime: string) => ({ vehicle: { id: vehicle }, driver: { id: driver }, startTime });
const byDriver = <T extends { driverSamsaraId: string }>(l: T[]) =>
  [...l].sort((x, y) => x.driverSamsaraId.localeCompare(y.driverSamsaraId));

describe("parseDriverCurrentTrucks (one truck per driver)", () => {
  it("puts a driver who moved trucks on the new one only — GROMEO left 506 for 807", () => {
    // The production shape on 2026-10-12: nobody drove 506 after him, so per truck he was still its
    // latest driver, inside the 30-day window.
    const r = parseDriverCurrentTrucks(
      { data: [row("sv-506", "gromeo", "2026-09-18T20:14:11Z"), row("sv-807", "gromeo", "2026-10-12T12:05:02Z")] },
      all,
    );
    expect(r.current).toEqual([{ vehicleSamsaraId: "sv-807", driverSamsaraId: "gromeo" }]);
    expect(r.seats).toEqual([{ vehicleSamsaraId: "sv-807", driverSamsaraId: "gromeo" }]);
  });

  it("keeps a team in its shared truck — WILLKENO is not sent back to the 586 he left (799, 2026-10-12)", () => {
    const r = parseDriverCurrentTrucks(
      {
        data: [
          row("sv-586", "willkeno", "2026-09-15T17:06:00Z"),
          row("sv-799", "willkeno", "2026-10-10T04:22:00Z"),
          row("sv-799", "jferguso", "2026-10-10T16:36:00Z"),
        ],
      },
      all,
    );
    expect(byDriver(r.current)).toEqual([
      { vehicleSamsaraId: "sv-799", driverSamsaraId: "jferguso" },
      { vehicleSamsaraId: "sv-799", driverSamsaraId: "willkeno" },
    ]);
    // One seat, to whoever of the two started last.
    expect(r.seats).toEqual([{ vehicleSamsaraId: "sv-799", driverSamsaraId: "jferguso" }]);
  });

  it("seats the driver we carry when the teammate who started later is not on our roster", () => {
    const r = parseDriverCurrentTrucks(
      { data: [row("sv-799", "willkeno", "2026-10-10T04:22:00Z"), row("sv-799", "jferguso", "2026-10-10T16:36:00Z")] },
      { isTruck: () => true, isDriver: (id) => id === "willkeno" },
    );
    expect(r.current).toEqual([{ vehicleSamsaraId: "sv-799", driverSamsaraId: "willkeno" }]);
    expect(r.seats).toEqual([{ vehicleSamsaraId: "sv-799", driverSamsaraId: "willkeno" }]);
  });

  it("gives the seat to whoever took the truck later, and leaves the one who left it in that truck only", () => {
    const r = parseDriverCurrentTrucks(
      { data: [row("t0", "a", "2026-09-01T00:00:00Z"), row("t1", "a", "2026-10-01T00:00:00Z"), row("t1", "b", "2026-10-05T00:00:00Z")] },
      all,
    );
    expect(byDriver(r.current)).toEqual([
      { vehicleSamsaraId: "t1", driverSamsaraId: "a" },
      { vehicleSamsaraId: "t1", driverSamsaraId: "b" },
    ]);
    expect(r.seats).toEqual([{ vehicleSamsaraId: "t1", driverSamsaraId: "b" }]);
  });

  it("ranks trucks only — a trailer hooked in the same second does not take the driver off the truck", () => {
    // JBURK on 2026-10-12: truck 796 and trailer R533129, both starting 13:11. The trailer's id sorts
    // first, so ranked together it would win the tie and 796 would lose its driver.
    const trucks = new Set(["281475006180758"]);
    const r = parseDriverCurrentTrucks(
      { data: [row("281475006180758", "jburk", "2026-10-12T13:11:00Z"), row("281474978756816", "jburk", "2026-10-12T13:11:00Z")] },
      { isTruck: (id) => trucks.has(id), isDriver: () => true },
    );
    expect(r.current).toEqual([{ vehicleSamsaraId: "281475006180758", driverSamsaraId: "jburk" }]);
  });

  it("answers the same whichever order Samsara pages the rows in, ties included", () => {
    const rows = [
      row("t2", "a", "2026-10-01T00:00:00Z"),
      row("t1", "a", "2026-10-01T00:00:00Z"),
      row("t3", "d", "2026-10-02T00:00:00Z"),
      row("t3", "c", "2026-10-02T00:00:00Z"),
    ];
    const forward = parseDriverCurrentTrucks({ data: rows }, all);
    const reversed = parseDriverCurrentTrucks({ data: [...rows].reverse() }, all);
    expect(byDriver(forward.current)).toEqual([
      { vehicleSamsaraId: "t1", driverSamsaraId: "a" },
      { vehicleSamsaraId: "t3", driverSamsaraId: "c" },
      { vehicleSamsaraId: "t3", driverSamsaraId: "d" },
    ]);
    expect(byDriver(forward.seats)).toEqual([
      { vehicleSamsaraId: "t1", driverSamsaraId: "a" },
      { vehicleSamsaraId: "t3", driverSamsaraId: "c" },
    ]);
    expect(byDriver(reversed.current)).toEqual(byDriver(forward.current));
    expect(byDriver(reversed.seats)).toEqual(byDriver(forward.seats));
  });

  it("reads the grouped shape too", () => {
    const r = parseDriverCurrentTrucks(
      {
        data: [
          { vehicle: { id: "t1" }, assignments: [{ driverId: "a", startTime: "2026-09-01T00:00:00Z" }] },
          { vehicle: { id: "t2" }, assignments: [{ driverId: "a", startTime: "2026-10-01T00:00:00Z" }] },
        ],
      },
      all,
    );
    expect(r.current).toEqual([{ vehicleSamsaraId: "t2", driverSamsaraId: "a" }]);
  });
});
