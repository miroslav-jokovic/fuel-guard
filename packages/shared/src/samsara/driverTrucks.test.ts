import { describe, it, expect } from "vitest";
import { parseDriverCurrentTrucks } from "./index.js";

describe("parseDriverCurrentTrucks (one truck per driver)", () => {
  it("puts a driver who moved trucks on the new one only — GROMEO left 506 for 807", () => {
    // The production shape on 2026-10-12: nobody drove 506 after him, so per truck he was still its
    // latest driver, inside the 30-day window.
    const links = parseDriverCurrentTrucks({
      data: [
        { vehicle: { id: "sv-506" }, driver: { id: "gromeo" }, startTime: "2026-09-18T20:14:11Z", endTime: "2026-09-18T21:24:49Z" },
        { vehicle: { id: "sv-807" }, driver: { id: "gromeo" }, startTime: "2026-10-12T12:05:02Z", endTime: "2026-10-12T13:54:33Z" },
      ],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "sv-807", driverSamsaraId: "gromeo" }]);
  });

  it("gives a driver no truck when the truck they last drove has since been taken by someone else", () => {
    const links = parseDriverCurrentTrucks({
      data: [
        { vehicle: { id: "t1" }, driver: { id: "a" }, startTime: "2026-10-01T00:00:00Z" },
        { vehicle: { id: "t1" }, driver: { id: "b" }, startTime: "2026-10-05T00:00:00Z" },
      ],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "t1", driverSamsaraId: "b" }]);
  });

  it("keeps a driver on a truck they left when nobody else drove it and they drove nothing newer", () => {
    const links = parseDriverCurrentTrucks({
      data: [{ vehicle: { id: "t1" }, driver: { id: "a" }, startTime: "2026-09-20T00:00:00Z", endTime: "2026-09-20T08:00:00Z" }],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "t1", driverSamsaraId: "a" }]);
  });

  it("answers the same whichever order Samsara pages the rows in, ties included", () => {
    const rows = [
      { vehicle: { id: "t2" }, driver: { id: "a" }, startTime: "2026-10-01T00:00:00Z" },
      { vehicle: { id: "t1" }, driver: { id: "a" }, startTime: "2026-10-01T00:00:00Z" },
      { vehicle: { id: "t3" }, driver: { id: "c" }, startTime: "2026-10-02T00:00:00Z" },
    ];
    const forward = parseDriverCurrentTrucks({ data: rows });
    const reversed = parseDriverCurrentTrucks({ data: [...rows].reverse() });
    const sort = (l: typeof forward) => [...l].sort((x, y) => x.driverSamsaraId.localeCompare(y.driverSamsaraId));
    expect(sort(forward)).toEqual([
      { vehicleSamsaraId: "t1", driverSamsaraId: "a" },
      { vehicleSamsaraId: "t3", driverSamsaraId: "c" },
    ]);
    expect(sort(reversed)).toEqual(sort(forward));
  });

  it("reads the grouped shape too", () => {
    const links = parseDriverCurrentTrucks({
      data: [
        { vehicle: { id: "t1" }, assignments: [{ driverId: "a", startTime: "2026-09-01T00:00:00Z" }] },
        { vehicle: { id: "t2" }, assignments: [{ driverId: "a", startTime: "2026-10-01T00:00:00Z" }] },
      ],
    });
    expect(links).toEqual([{ vehicleSamsaraId: "t2", driverSamsaraId: "a" }]);
  });
});
