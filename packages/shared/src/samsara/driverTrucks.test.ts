import { describe, it, expect } from "vitest";
import { parseDriverCurrentTrucks, planDriverSeats } from "./index.js";

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

describe("planDriverSeats (who may hold a truck)", () => {
  const t = (id: string, sid: string | null, holder: string | null) => ({ id, samsaraVehicleId: sid, assignedDriverId: holder });
  const d = (id: string, sid: string | null, status = "active", archived = false) => ({ id, samsaraDriverId: sid, status, archived });

  it("seats the latest driver who may hold a truck, skipping a former one who drove it later", () => {
    const plan = parseRows([row("sv-647", "s-term", "2026-10-08T00:00:00Z"), row("sv-647", "s-a", "2026-09-14T00:00:00Z")],
      [t("647", "sv-647", null)], [d("term", "s-term", "terminated"), d("a", "s-a")]);
    expect(plan).toEqual({ set: [{ vehicleId: "647", driverId: "a" }], clear: [], seated: 1 });
  });

  it("clears a truck a former or archived driver still holds, and keeps one a driver on leave holds", () => {
    const plan = parseRows([], [t("563", "sv-563", "inact"), t("578", null, "arch"), t("700", "sv-700", "leave")],
      [d("inact", "s-1", "inactive"), d("arch", null, "active", true), d("leave", "s-3", "on_leave")]);
    expect(plan.clear).toEqual([{ vehicleId: "563", driverId: "inact" }, { vehicleId: "578", driverId: "arch" }]);
    expect(plan.set).toEqual([]);
  });

  it("does not clear a truck whose seat it just gave to someone else", () => {
    const plan = parseRows([row("sv-1", "s-b", "2026-10-05T00:00:00Z")], [t("1", "sv-1", "former")],
      [d("former", null, "terminated"), d("b", "s-b")]);
    expect(plan).toEqual({ set: [{ vehicleId: "1", driverId: "b" }], clear: [], seated: 1 });
  });

  it("leaves a truck alone whose driver the roster read did not return", () => {
    expect(parseRows([], [t("1", "sv-1", "ghost")], []).clear).toEqual([]);
  });

  function parseRows(rows: ReturnType<typeof row>[], trucks: ReturnType<typeof t>[], drivers: ReturnType<typeof d>[]) {
    return planDriverSeats({ data: rows }, trucks, drivers);
  }
});
