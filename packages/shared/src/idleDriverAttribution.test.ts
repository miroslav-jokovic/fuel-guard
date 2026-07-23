import { describe, it, expect } from "vitest";
import { driverAt, attributeDriverIdle, type DriverAssignment, type IdleBucket } from "./idleDriverAttribution.js";

const day = (d: number, h = 12) => Date.UTC(2026, 2, d, h);
const H = 3600;

const assignments: DriverAssignment[] = [
  { vehicleSamsaraId: "V1", driverSamsaraId: "D1", startMs: day(1, 0), endMs: day(5, 0) },
  { vehicleSamsaraId: "V1", driverSamsaraId: "D2", startMs: day(5, 0), endMs: null }, // D2 takes over from the 5th
  { vehicleSamsaraId: "V2", driverSamsaraId: "D3", startMs: day(1, 0), endMs: null },
];

describe("driverAt", () => {
  it("resolves the driver assigned at an instant; later start wins on overlap", () => {
    expect(driverAt(assignments, "V1", day(3))).toBe("D1");
    expect(driverAt(assignments, "V1", day(6))).toBe("D2"); // after handover
    expect(driverAt(assignments, "V2", day(3))).toBe("D3");
  });
  it("returns null before any assignment or for an unknown vehicle", () => {
    expect(driverAt(assignments, "V1", Date.UTC(2026, 1, 1))).toBeNull();
    expect(driverAt(assignments, "V9", day(3))).toBeNull();
  });
});

describe("attributeDriverIdle", () => {
  it("credits each bucket to the driver assigned at its instant", () => {
    const buckets: IdleBucket[] = [
      { vehicleSamsaraId: "V1", atMs: day(3), avoidableSec: 2 * H, engineOnSec: 10 * H, idleSec: 3 * H }, // D1
      { vehicleSamsaraId: "V1", atMs: day(6), avoidableSec: 1 * H, engineOnSec: 8 * H, idleSec: 2 * H }, // D2
      { vehicleSamsaraId: "V2", atMs: day(3), avoidableSec: 0, engineOnSec: 12 * H, idleSec: 1 * H }, // D3
    ];
    const rows = attributeDriverIdle(buckets, assignments);
    const byId = Object.fromEntries(rows.map((r) => [r.driverSamsaraId, r]));
    expect(byId["D1"]).toEqual({ driverSamsaraId: "D1", avoidableSec: 2 * H, engineOnSec: 10 * H, idleSec: 3 * H, confidentEngineOnSec: 0 });
    expect(byId["D2"]).toEqual({ driverSamsaraId: "D2", avoidableSec: 1 * H, engineOnSec: 8 * H, idleSec: 2 * H, confidentEngineOnSec: 0 });
    expect(byId["D3"]!.avoidableSec).toBe(0);
    expect(byId["D3"]!.engineOnSec).toBe(12 * H);
  });

  it("sends buckets with no covering assignment to the null (unattributed) driver", () => {
    const buckets: IdleBucket[] = [
      { vehicleSamsaraId: "V1", atMs: Date.UTC(2026, 1, 1), avoidableSec: 5 * H, engineOnSec: 9 * H, idleSec: 6 * H }, // before any assignment
    ];
    const rows = attributeDriverIdle(buckets, assignments);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.driverSamsaraId).toBeNull();
    expect(rows[0]!.avoidableSec).toBe(5 * H);
  });

  it("sums multiple buckets for the same driver", () => {
    const buckets: IdleBucket[] = [
      { vehicleSamsaraId: "V1", atMs: day(2), avoidableSec: 1 * H, engineOnSec: 4 * H, idleSec: 1 * H },
      { vehicleSamsaraId: "V1", atMs: day(3), avoidableSec: 2 * H, engineOnSec: 5 * H, idleSec: 2 * H },
    ];
    const rows = attributeDriverIdle(buckets, assignments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ driverSamsaraId: "D1", avoidableSec: 3 * H, engineOnSec: 9 * H, idleSec: 3 * H, confidentEngineOnSec: 0 });
  });

  it("tracks confident engine-on separately so unjudgeable trucks still attribute engine-on but no score basis", () => {
    const buckets: IdleBucket[] = [
      { vehicleSamsaraId: "V1", atMs: day(3), avoidableSec: 0, engineOnSec: 6 * H, idleSec: 2 * H, confidentEngineOnSec: 6 * H }, // confident
      { vehicleSamsaraId: "V1", atMs: day(4), avoidableSec: 0, engineOnSec: 4 * H, idleSec: 1 * H }, // not judgeable → 0 basis
    ];
    const rows = attributeDriverIdle(buckets, assignments);
    expect(rows[0]).toEqual({ driverSamsaraId: "D1", avoidableSec: 0, engineOnSec: 10 * H, idleSec: 3 * H, confidentEngineOnSec: 6 * H });
  });
});
