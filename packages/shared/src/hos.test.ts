import { describe, it, expect } from "vitest";
import {
  normalizeHosStatus,
  hosDutyKind,
  parseHosLogs,
  hosOverlapSeconds,
  parseHosClocks,
  type HosSegment,
} from "./hos.js";

const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000;
const T0 = Date.parse("2026-06-01T00:00:00.000Z");

describe("normalizeHosStatus", () => {
  it("maps every Samsara enum value", () => {
    expect(normalizeHosStatus("offDuty")).toBe("off_duty");
    expect(normalizeHosStatus("sleeperBed")).toBe("sleeper");
    expect(normalizeHosStatus("driving")).toBe("driving");
    expect(normalizeHosStatus("onDuty")).toBe("on_duty");
    expect(normalizeHosStatus("yardMove")).toBe("yard_move");
    expect(normalizeHosStatus("personalConveyance")).toBe("personal_conveyance");
  });
  it("tolerates the alternate 'sleeperBerth' spelling and casing/spacing", () => {
    expect(normalizeHosStatus("sleeperBerth")).toBe("sleeper");
    expect(normalizeHosStatus("On Duty")).toBe("on_duty");
    expect(normalizeHosStatus("OFF_DUTY")).toBe("off_duty");
  });
  it("unrecognized / empty -> unknown (never guessed)", () => {
    expect(normalizeHosStatus("waitingTime")).toBe("unknown");
    expect(normalizeHosStatus(null)).toBe("unknown");
    expect(normalizeHosStatus("")).toBe("unknown");
  });
});

describe("hosDutyKind", () => {
  it("classifies rest/work/driving/excluded", () => {
    expect(hosDutyKind("sleeper")).toBe("rest");
    expect(hosDutyKind("off_duty")).toBe("rest");
    expect(hosDutyKind("on_duty")).toBe("work");
    expect(hosDutyKind("driving")).toBe("driving");
    expect(hosDutyKind("yard_move")).toBe("excluded");
    expect(hosDutyKind("personal_conveyance")).toBe("excluded");
    expect(hosDutyKind("unknown")).toBe("unknown");
  });
});

describe("parseHosLogs", () => {
  it("builds contiguous segments; each ends at the next log's start", () => {
    const data = [
      {
        driver: { id: 42 },
        logs: [
          { logStartTime: iso(T0), dutyStatus: "driving" },
          { logStartTime: iso(T0 + 2 * H), dutyStatus: "onDuty" },
          { logStartTime: iso(T0 + 3 * H), dutyStatus: "sleeperBed" },
        ],
      },
    ];
    const segs = parseHosLogs(data, { windowEndMs: T0 + 13 * H });
    expect(segs).toEqual<HosSegment[]>([
      { driverId: "42", status: "driving", startMs: T0, endMs: T0 + 2 * H },
      { driverId: "42", status: "on_duty", startMs: T0 + 2 * H, endMs: T0 + 3 * H },
      { driverId: "42", status: "sleeper", startMs: T0 + 3 * H, endMs: T0 + 13 * H },
    ]);
  });

  it("last open log is null when no window end is given", () => {
    const segs = parseHosLogs([
      { driverId: "7", logs: [{ logStartTime: iso(T0), dutyStatus: "offDuty" }] },
    ]);
    expect(segs[0]!.endMs).toBeNull();
  });

  it("gathers one driver's logs split across pages, de-dupes, and orders", () => {
    const data = [
      { driver: { id: 1 }, logs: [{ logStartTime: iso(T0 + 3 * H), dutyStatus: "sleeperBed" }] },
      {
        driver: { id: 1 },
        logs: [
          { logStartTime: iso(T0), dutyStatus: "driving" },
          { logStartTime: iso(T0 + 3 * H), dutyStatus: "sleeperBed" },
        ],
      },
    ];
    const segs = parseHosLogs(data, { windowEndMs: T0 + 5 * H });
    expect(segs.map((s) => [s.status, s.startMs])).toEqual([
      ["driving", T0],
      ["sleeper", T0 + 3 * H],
    ]);
  });

  it("skips malformed logs (bad time / missing status) without dropping the driver", () => {
    const segs = parseHosLogs(
      [
        {
          driver: { id: 9 },
          logs: [
            { logStartTime: "not-a-date", dutyStatus: "driving" },
            { logStartTime: iso(T0), dutyStatus: "onDuty" },
          ],
        },
      ],
      { windowEndMs: T0 + H },
    );
    expect(segs).toEqual([{ driverId: "9", status: "on_duty", startMs: T0, endMs: T0 + H }]);
  });

  it("tolerates alternate field names (startTime / hosStatusType)", () => {
    const segs = parseHosLogs(
      [{ driverId: 5, logs: [{ startTime: iso(T0), hosStatusType: "sleeperBed" }] }],
      { windowEndMs: T0 + H },
    );
    expect(segs[0]).toEqual({ driverId: "5", status: "sleeper", startMs: T0, endMs: T0 + H });
  });
});

describe("hosOverlapSeconds", () => {
  const segs: HosSegment[] = [
    { driverId: "1", status: "driving", startMs: T0, endMs: T0 + 2 * H },
    { driverId: "1", status: "on_duty", startMs: T0 + 2 * H, endMs: T0 + 3 * H },
    { driverId: "1", status: "sleeper", startMs: T0 + 3 * H, endMs: T0 + 13 * H },
  ];

  it("splits a park window into rest/work/driving buckets, clamped to the range", () => {
    const o = hosOverlapSeconds(segs, T0 + 2.5 * H, T0 + 11 * H);
    expect(o.workSec).toBe(0.5 * 3600);
    expect(o.restSec).toBe(8 * 3600);
    expect(o.drivingSec).toBe(0);
    expect(o.coveredSec).toBe(8.5 * 3600);
  });

  it("treats an open (null-end) segment as running to the range end", () => {
    const open: HosSegment[] = [{ driverId: "1", status: "sleeper", startMs: T0, endMs: null }];
    const o = hosOverlapSeconds(open, T0 + H, T0 + 4 * H);
    expect(o.restSec).toBe(3 * 3600);
  });

  it("counts unknown-status time separately and leaves gaps uncounted", () => {
    const o = hosOverlapSeconds(
      [{ driverId: "1", status: "unknown", startMs: T0, endMs: T0 + H }],
      T0,
      T0 + 2 * H,
    );
    expect(o.unknownSec).toBe(3600);
    expect(o.coveredSec).toBe(3600);
  });

  it("returns zeros for an empty/inverted range", () => {
    expect(hosOverlapSeconds(segs, T0 + H, T0 + H).coveredSec).toBe(0);
    expect(hosOverlapSeconds(segs, T0 + 2 * H, T0 + H).coveredSec).toBe(0);
  });
});

describe("parseHosLogs — real Samsara /fleet/hos/logs shape", () => {
  it("reads hosLogs[] + hosStatusType + logStartTime/logEndTime", () => {
    const T = Date.parse("2026-06-01T00:00:00.000Z");
    const HH = 3600_000;
    const data = [
      {
        driver: { id: "57168899", name: "MICHAEL KENT" },
        hosLogs: [
          {
            logStartTime: new Date(T).toISOString(),
            logEndTime: new Date(T + 2 * HH).toISOString(),
            hosStatusType: "driving",
            vehicle: { id: "556" },
          },
          {
            logStartTime: new Date(T + 2 * HH).toISOString(),
            logEndTime: new Date(T + 12 * HH).toISOString(),
            hosStatusType: "sleeperBed",
          },
        ],
      },
    ];
    const segs = parseHosLogs(data);
    expect(segs).toEqual([
      { driverId: "57168899", status: "driving", startMs: T, endMs: T + 2 * HH },
      { driverId: "57168899", status: "sleeper", startMs: T + 2 * HH, endMs: T + 12 * HH },
    ]);
  });
});

describe("parseHosClocks — current duty status per driver", () => {
  it("reads currentDutyStatus.hosStatusType + currentVehicle from the clocks feed", () => {
    const data = [
      {
        driver: { id: "57168899", name: "MICHAEL KENT" },
        currentVehicle: { id: "212", name: "556" },
        currentDutyStatus: { hosStatusType: "driving" },
      },
      { driver: { id: "99", name: "No Truck" }, currentDutyStatus: { hosStatusType: "offDuty" } },
      { currentDutyStatus: { hosStatusType: "driving" } }, // no driver → skipped
    ];
    expect(parseHosClocks(data)).toEqual([
      { driverId: "57168899", status: "driving", vehicleId: "212", vehicleName: "556" },
      { driverId: "99", status: "off_duty", vehicleId: null, vehicleName: null },
    ]);
  });
});
