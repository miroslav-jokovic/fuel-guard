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
    expect(plan).toEqual({ set: [{ vehicleId: "647", driverId: "a" }], clear: [], seated: 1, teammates: [] });
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
    expect(plan).toEqual({ set: [{ vehicleId: "1", driverId: "b" }], clear: [], seated: 1, teammates: [] });
  });

  it("leaves a truck alone whose driver the roster read did not return", () => {
    expect(parseRows([], [t("1", "sv-1", "ghost")], []).clear).toEqual([]);
  });

  describe("the team truck's second seat (0475)", () => {
    // 729 on 2026-10-15: McLeod has CSITAL and LFEAGIN on it; Samsara has both in it; one seat.
    // A team interleaves: each has driven it since the other first did.
    const team = [
      row("sv-729", "s-feagin", "2026-09-15T15:22:00Z"), row("sv-729", "s-sital", "2026-09-15T20:46:00Z"),
      row("sv-729", "s-sital", "2026-10-09T11:48:00Z"), row("sv-729", "s-feagin", "2026-10-10T06:00:00Z"),
    ];
    const tc = (holder: string | null, co: string | null | undefined) => ({ ...t("729", "sv-729", holder), coDriverId: co });

    it("puts the teammate the one seat left out in the second seat", () => {
      const plan = parseRows(team, [tc("feagin", null)], [d("sital", "s-sital"), d("feagin", "s-feagin")]);
      expect(plan.teammates).toEqual([{ vehicleId: "729", driverId: "sital", expected: null }]);
    });

    it("writes nothing when the second seat is already right", () => {
      expect(parseRows(team, [tc("feagin", "sital")], [d("sital", "s-sital"), d("feagin", "s-feagin")]).teammates).toEqual([]);
    });

    it("empties the second seat once the team is no longer in the truck — it is current state", () => {
      const solo = [row("sv-729", "s-feagin", "2026-10-10T06:00:00Z"), row("sv-800", "s-sital", "2026-10-12T00:00:00Z")];
      const plan = parseRows(solo, [tc("feagin", "sital"), t("800", "sv-800", null)], [d("sital", "s-sital"), d("feagin", "s-feagin")]);
      expect(plan.teammates).toEqual([{ vehicleId: "729", driverId: null, expected: "sital" }]);
    });

    it("does not call a hand-over a team — 657 on 2026-10-15", () => {
      // Williams last drove 657 on 09-16; Baroni took it on 10-13. Williams has driven nothing since,
      // so 657 is still his "current" truck — but he is not in it with Baroni.
      const handOver = [row("sv-657", "s-williams", "2026-09-16T16:00:00Z"), row("sv-657", "s-baroni", "2026-10-13T14:15:00Z")];
      const plan = parseRows(handOver, [{ ...t("657", "sv-657", "baroni"), coDriverId: null }], [d("williams", "s-williams"), d("baroni", "s-baroni")]);
      expect(plan.teammates).toEqual([]);
    });

    it("keeps a team whose drivers interleave, whoever started last", () => {
      const interleaved = [
        row("sv-729", "s-feagin", "2026-09-15T15:22:00Z"), row("sv-729", "s-sital", "2026-09-15T20:46:00Z"),
        row("sv-729", "s-sital", "2026-10-08T09:19:00Z"), row("sv-729", "s-feagin", "2026-10-09T11:44:00Z"),
      ];
      const plan = parseRows(interleaved, [tc("feagin", null)], [d("sital", "s-sital"), d("feagin", "s-feagin")]);
      expect(plan.teammates).toEqual([{ vehicleId: "729", driverId: "sital", expected: null }]);
    });

    it("never seats a former driver as the teammate", () => {
      const plan = parseRows(team, [tc("feagin", null)], [d("sital", "s-sital", "terminated"), d("feagin", "s-feagin")]);
      expect(plan.teammates).toEqual([]);
    });

    it("gives the first seat by Samsara's order and the second to the one it displaced", () => {
      // The office seated SITAL by hand; Samsara ranks FEAGIN first. Step 1 hands the seat to FEAGIN,
      // so SITAL is the teammate — not FEAGIN in both seats.
      const plan = parseRows(team, [tc("sital", null)], [d("sital", "s-sital"), d("feagin", "s-feagin")]);
      expect(plan.set).toEqual([{ vehicleId: "729", driverId: "feagin" }]);
      expect(plan.teammates).toEqual([{ vehicleId: "729", driverId: "sital", expected: null }]);
    });

    it("plans no second seat for a caller that did not read the column", () => {
      expect(parseRows(team, [t("729", "sv-729", "feagin")], [d("sital", "s-sital"), d("feagin", "s-feagin")]).teammates).toEqual([]);
    });

    it("ranks a third driver out, as the first seat ranks the second", () => {
      // The oldest start comes FIRST in the feed, so taking whoever is seen first would pick it.
      const three = [row("sv-729", "s-x", "2026-10-01T00:00:00Z"), ...team];
      const plan = parseRows(three, [tc("feagin", null)], [d("sital", "s-sital"), d("feagin", "s-feagin"), d("x", "s-x")]);
      expect(plan.teammates).toEqual([{ vehicleId: "729", driverId: "sital", expected: null }]);
    });
  });

  function parseRows(rows: ReturnType<typeof row>[], trucks: ReturnType<typeof t>[], drivers: ReturnType<typeof d>[]) {
    return planDriverSeats({ data: rows }, trucks, drivers);
  }
});
