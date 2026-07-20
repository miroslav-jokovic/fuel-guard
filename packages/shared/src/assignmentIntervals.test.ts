import { describe, it, expect } from "vitest";
import { parseAssignmentIntervals, matchAssignmentAt } from "./samsara/index.js";

describe("parseAssignmentIntervals", () => {
  it("parses grouped assignments into time-ranged intervals", () => {
    const iv = parseAssignmentIntervals({
      data: [
        {
          vehicle: { id: "v1" },
          assignments: [
            {
              driver: { id: "d1" },
              startTime: "2026-07-08T00:00:00Z",
              endTime: "2026-07-08T06:00:00Z",
            },
            { driver: { id: "d2" }, startTime: "2026-07-08T06:00:00Z" }, // open
          ],
        },
      ],
    });
    expect(iv).toHaveLength(2);
    expect(iv[0]).toMatchObject({
      vehicleSamsaraId: "v1",
      driverSamsaraId: "d1",
      endMs: Date.parse("2026-07-08T06:00:00Z"),
    });
    expect(iv[1]!.endMs).toBeNull();
  });
  it("parses the flat shape and skips rows without a start or driver", () => {
    const iv = parseAssignmentIntervals({
      data: [
        { vehicle: { id: "v2" }, driver: { id: "d9" }, startTime: "2026-07-01T00:00:00Z" },
        { vehicle: { id: "v2" }, startTime: "2026-07-02T00:00:00Z" }, // no driver → skipped
      ],
    });
    expect(iv).toHaveLength(1);
    expect(iv[0]!.driverSamsaraId).toBe("d9");
  });
});

describe("matchAssignmentAt", () => {
  const iv = [
    {
      vehicleSamsaraId: "v1",
      driverSamsaraId: "d1",
      startMs: Date.parse("2026-07-08T00:00:00Z"),
      endMs: Date.parse("2026-07-08T06:00:00Z"),
    },
    {
      vehicleSamsaraId: "v1",
      driverSamsaraId: "d2",
      startMs: Date.parse("2026-07-08T06:00:00Z"),
      endMs: null,
    },
    {
      vehicleSamsaraId: "v9",
      driverSamsaraId: "dX",
      startMs: Date.parse("2026-07-08T00:00:00Z"),
      endMs: null,
    },
  ];
  it("returns the covering interval's driver", () => {
    expect(matchAssignmentAt(iv, "v1", Date.parse("2026-07-08T03:00:00Z"))).toBe("d1");
    expect(matchAssignmentAt(iv, "v1", Date.parse("2026-07-08T09:00:00Z"))).toBe("d2"); // open interval covers
  });
  it("falls back to the last-known driver within the stale window", () => {
    const only = [
      {
        vehicleSamsaraId: "v1",
        driverSamsaraId: "d1",
        startMs: Date.parse("2026-07-08T00:00:00Z"),
        endMs: Date.parse("2026-07-08T06:00:00Z"),
      },
    ];
    expect(matchAssignmentAt(only, "v1", Date.parse("2026-07-08T10:00:00Z"))).toBe("d1"); // 4h after end → within 24h
  });
  it("does not attribute a stale driver beyond the window", () => {
    const only = [
      {
        vehicleSamsaraId: "v1",
        driverSamsaraId: "d1",
        startMs: Date.parse("2026-07-01T00:00:00Z"),
        endMs: Date.parse("2026-07-01T06:00:00Z"),
      },
    ];
    expect(matchAssignmentAt(only, "v1", Date.parse("2026-07-08T10:00:00Z"))).toBeNull();
  });
  it("returns null for an unknown vehicle", () => {
    expect(matchAssignmentAt(iv, "vZ", Date.parse("2026-07-08T03:00:00Z"))).toBeNull();
  });
});
