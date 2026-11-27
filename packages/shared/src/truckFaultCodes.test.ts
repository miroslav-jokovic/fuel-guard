import { describe, expect, it } from "vitest";
import { faultCodeGroup, faultCodesCameAndWent, faultCodeWindow, type TruckFaultCode } from "./truckFaultCodes.js";

const code = (spn: number, fmi: number, module: number | null = 0, extra: Partial<TruckFaultCode> = {}): TruckFaultCode => ({
  module, moduleName: null, spn, fmi, description: null, fmiDescription: null, makerSpecific: false, occurrences: 1, ...extra,
});

describe("faultCodeGroup", () => {
  it("folds the camera, radar and telematics controllers and keeps every other address with the truck's own", () => {
    expect([232, 42, 74, 37, 76].map((m) => faultCodeGroup({ module: m }))).toEqual(Array(5).fill("electronics"));
    // Engine #1, the exhaust controller, an address never seen before, and no address at all.
    expect([0, 61, 199, null].map((m) => faultCodeGroup({ module: m }))).toEqual(Array(4).fill("vehicle"));
  });
});

describe("faultCodesCameAndWent", () => {
  it("lists a code seen in the window and gone now, from its first to its last reading, newest first", () => {
    const history = [
      { at: "2026-11-20T10:00:00.000Z", codes: [code(100, 1), code(200, 3)] },
      { at: "2026-11-21T10:00:00.000Z", codes: [code(100, 1, 0, { occurrences: 4 }), code(200, 3)] },
      { at: "2026-11-22T10:00:00.000Z", codes: [code(200, 3), code(300, 2)] },
      { at: "2026-11-23T10:00:00.000Z", codes: [code(200, 3)] },
    ];
    const out = faultCodesCameAndWent(history, [code(200, 3)]);
    expect(out.map((c) => [c.spn, c.firstSeen, c.lastSeen, c.occurrences])).toEqual([
      [300, "2026-11-22T10:00:00.000Z", "2026-11-22T10:00:00.000Z", 1],
      [100, "2026-11-20T10:00:00.000Z", "2026-11-21T10:00:00.000Z", 4],
    ]);
  });

  it("tells the same SPN apart by its FMI and by the controller that raised it", () => {
    const history = [{ at: "2026-11-20T10:00:00.000Z", codes: [code(100, 1, 0), code(100, 2, 0), code(100, 1, 1)] }];
    expect(faultCodesCameAndWent(history, [code(100, 1, 0)])).toHaveLength(2);
  });

  it("answers nothing for a quiet truck whose history is empty", () => {
    expect(faultCodesCameAndWent([], [code(100, 1)])).toEqual([]);
  });
});

describe("faultCodeWindow", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  it("starts a day before the follow-up's first warning", () => {
    expect(faultCodeWindow("2026-11-24T08:00:00.000Z", now)).toEqual({ sinceIso: "2026-11-23T08:00:00.000Z", capped: false });
  });
  it("never reaches back more than 30 days, and says so", () => {
    expect(faultCodeWindow("2026-09-01T00:00:00.000Z", now)).toEqual({ sinceIso: "2026-10-28T12:00:00.000Z", capped: true });
  });
});
