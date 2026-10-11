import { describe, it, expect } from "vitest";
import { APPENDIX_A_EDITIONS, appendixFor, basicPoints, monthsBefore, scoreSms, timeWeight, type SmsInspectionInput } from "../src/index.js";

const M = "2026-08-28";
const insp = (o: Partial<SmsInspectionInput> = {}): SmsInspectionInput => ({
  id: "i1", date: "2026-08-01", level: 1, hazmatPlacard: true, addedOn: "2026-08-02", violations: [], ...o,
});
const v = (code: string, o: Partial<SmsInspectionInput["violations"][number]> = {}) => ({ id: code, code, outOfService: false, citationResult: null, ...o });

describe("time weight (Methodology v3.21 §3)", () => {
  it("steps 3 / 2 / 1 at 6 and 12 months, each boundary in the newer bucket, nothing past 24", () => {
    expect(timeWeight("2026-02-28", M)).toBe(3);
    expect(timeWeight("2026-02-27", M)).toBe(2);
    expect(timeWeight("2025-08-28", M)).toBe(2);
    expect(timeWeight("2025-08-27", M)).toBe(1);
    expect(timeWeight("2024-08-28", M)).toBe(1);
    expect(timeWeight("2024-08-27", M)).toBeNull();
    expect(timeWeight("2026-08-29", M)).toBeNull();
  });

  it("clamps a month-end to the shorter month", () => {
    expect(monthsBefore("2026-08-31", 6)).toBe("2026-02-28");
    expect(monthsBefore("2028-08-31", 6)).toBe("2028-02-29");
    expect(monthsBefore("2026-01-15", 12)).toBe("2025-01-15");
  });
});

describe("scoreSms", () => {
  it("weights a tyre violation from Appendix A, adds 2 when out of service, and keeps the time weight apart", () => {
    const s = scoreSms([insp({ violations: [v("393.75A3-TAOL", { outOfService: true })] })], M);
    expect(s.inspections[0]!.violations[0]).toMatchObject({ key: "39375A3TAOL", basic: "vehicle_maintenance", severityWeight: 8, oosWeight: 2, timeWeight: 3, totalSeverityWeight: 10 });
  });

  it("gives Unsafe Driving and Controlled Substances no OOS weight", () => {
    const s = scoreSms([insp({ violations: [v("392.2-SLLS3", { outOfService: true }), v("392.4A", { outOfService: true })] })], M);
    expect(s.inspections[0]!.violations.map((x) => [x.basic, x.oosWeight])).toEqual([["unsafe_driving", 0], ["controlled_substances_alcohol", 0]]);
  });

  it("removes a dismissed citation and sets a different-charge conviction to severity 1 without OOS", () => {
    const s = scoreSms([insp({ violations: [v("392.2-SLLS3", { citationResult: 3 }), v("393.75A3-TAOL", { outOfService: true, citationResult: 2 }), v("392.16", { citationResult: 1 })] })], M);
    expect(s.excluded).toContainEqual({ inspectionId: "i1", violationId: "392.2-SLLS3", reason: "dismissed" });
    expect(s.inspections[0]!.violations.map((x) => [x.key, x.severityWeight, x.oosWeight])).toEqual([["39375A3TAOL", 1, 0], ["39216", 7, 0]]);
  });

  it("counts a code once per inspection, out of service if any occurrence was", () => {
    const s = scoreSms([insp({ violations: [v("393.75A3-TAOL"), { ...v("393.75A3-TAOL", { outOfService: true }), id: "second" }] })], M);
    expect(s.inspections[0]!.violations).toHaveLength(1);
    expect(s.inspections[0]!.violations[0]).toMatchObject({ ids: ["393.75A3-TAOL", "second"], oosWeight: 2 });
    expect(s.excluded).toContainEqual({ inspectionId: "i1", violationId: "second", reason: "counted_once" });
  });

  it("leaves out maintenance on a driver-only inspection and HM where nothing placardable was carried", () => {
    const s = scoreSms([
      insp({ id: "L3", level: 3, violations: [v("393.75A3-TAOL"), v("395.8A")] }),
      insp({ id: "noplac", hazmatPlacard: false, violations: [v("172.202A1-HMSPS")] }),
    ], M);
    expect(s.excluded).toEqual([
      { inspectionId: "L3", violationId: "393.75A3-TAOL", reason: "level_not_relevant" },
      { inspectionId: "noplac", violationId: "172.202A1-HMSPS", reason: "hm_not_placardable" },
    ]);
    expect(s.inspections[0]!.violations.map((x) => x.basic)).toEqual(["hos_compliance"]);
  });

  it("leaves out an inspection outside the window, one loaded on or after the measurement date, and an unknown code", () => {
    const s = scoreSms([
      insp({ id: "old", date: "2024-08-27" }),
      insp({ id: "late", date: "2026-08-26", addedOn: "2026-08-28" }),
      insp({ id: "ok", violations: [v("391.10")] }),
    ], M);
    expect(s.excluded.map((e) => [e.inspectionId, e.reason])).toEqual([["old", "outside_window"], ["late", "not_loaded"], ["ok", "not_in_appendix"]]);
  });

  it("refuses a date no Appendix A edition we hold covers, rather than scoring under a guess", () => {
    expect(appendixFor("2026-05-14")).toBeNull();
    expect(appendixFor("2026-05-15")?.version).toBe("3.21");
    expect(() => scoreSms([], "2026-01-01")).toThrow(/no Appendix A edition/);
    expect(() => scoreSms([], "08/28/2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("basicPoints", () => {
  it("caps one inspection's BASIC sum at 30 before time weighting", () => {
    // Severities 8, 4, 4, 4 plus OOS 2 each: 28, then the 10-point 392.63, not OOS, makes 38.
    const codes = ["393.75A3-TAOL", "393.48A", "393.45B2", "393.47E", "392.63"];
    const s = scoreSms([insp({ date: "2025-12-01", violations: codes.map((c) => v(c, { outOfService: c !== "392.63" })) })], M);
    const p = basicPoints(s.inspections[0]!, "vehicle_maintenance");
    expect(p.severitySum).toBe(38);
    expect(p).toMatchObject({ capped: 30, points: 60 });
    expect(basicPoints(s.inspections[0]!, "hos_compliance")).toEqual({ severitySum: 0, capped: 0, points: 0 });
  });
});

describe("Appendix A 3.21", () => {
  it("holds 2,412 violations keyed uniquely, pinned to the workbook's hash", () => {
    const e = APPENDIX_A_EDITIONS[0]!;
    expect(e.byKey.size).toBe(2412);
    expect(e.sha256).toBe("962edfb555385906238b23f6b8846c643e605b54dbc9ded97a44d68a788892b7");
  });
});
