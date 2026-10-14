import { describe, expect, it } from "vitest";
import type { RoadsideInspectionSmsDto } from "@silvicom/shared";
import { inspectionSms, type SmsInspectionFacts } from "./inspectionSms.js";

/**
 * The Inspection page's CSA points, run through the real `@silvicom/sms-engine` and its Appendix A
 * v3.21 — no stub, so a weight here is FMCSA's weight (severities as printed in the workbook:
 * 393.75A3-TAOL 8, 392.63 10, 393.47(a) 4, 393.45 4, 395.8(e) 7, 392.2LC 5, 172.202A1-HMSPS 3).
 */

const TODAY = "2026-10-14";
let n = 0;
const v = (code: string | null, outOfService = false, citationCode: number | null = null) => ({ id: `v${++n}`, code, outOfService, citationCode });
const insp = (violations: SmsInspectionFacts["violations"], o: Partial<SmsInspectionFacts> = {}): SmsInspectionFacts => ({
  id: "i1", date: "2026-08-20", level: 1, hazmatPlacard: false, postAccident: false, mcmisAddDate: "20260821 0915", violations, ...o,
});
const score = (facts: SmsInspectionFacts) => inspectionSms(facts, TODAY) as RoadsideInspectionSmsDto;

describe("CSA points per violation on the Inspection page (D-IC6)", () => {
  it("gives a counted violation its severity, +2 out of service and the time weight, and the BASIC its 30-point cap", () => {
    const [a, b, c, d, e] = [v("393.75A3-TAOL", true), v("392.63", true), v("393.47(a)", true), v("393.45"), v("395.8(e)")];
    const s = score(insp([a!, b!, c!, d!, e!]));
    expect(s.measuredOn).toBe(TODAY);
    expect(s.appendixVersion).toBe("3.21");
    expect(s.timeWeight).toBe(3);
    expect(s.violations[a!.id]).toEqual({ status: "scored", basic: "vehicle_maintenance", severityWeight: 8, oosWeight: 2, timeWeight: 3, points: 30 });
    expect(s.violations[d!.id]).toEqual({ status: "scored", basic: "vehicle_maintenance", severityWeight: 4, oosWeight: 0, timeWeight: 3, points: 12 });
    expect(s.basics).toEqual([
      { basic: "hos_compliance", verified: true, severitySum: 7, capped: 7, points: 21 },
      { basic: "vehicle_maintenance", verified: true, severitySum: 32, capped: 30, points: 90 },
    ]);
  });

  it("weighs an inspection 6–12 months old by 2", () => {
    const a = v("393.45");
    const s = score(insp([a], { date: "2026-02-01", mcmisAddDate: "20260202 1000" }));
    expect([s.timeWeight, s.violations[a.id]]).toEqual([2, { status: "scored", basic: "vehicle_maintenance", severityWeight: 4, oosWeight: 0, timeWeight: 2, points: 8 }]);
  });

  it("withholds Hazardous Materials points and its total, because the calculator does not equal FMCSA there (Q-IC9)", () => {
    const a = v("172.202A1-HMSPS", true);
    const s = score(insp([a], { hazmatPlacard: true }));
    expect(s.violations[a.id]).toEqual({ status: "withheld", basic: "hm_compliance" });
    expect(s.basics).toEqual([{ basic: "hm_compliance", verified: false }]);
  });

  it("gives every violation SMS leaves out its reason instead of points", () => {
    const placard = v("172.202A1-HMSPS");
    const unknown = v("999.9X");
    const blank = v(null);
    const dismissed = v("395.8(e)", false, 3);
    const s = score(insp([placard, unknown, blank, dismissed]));
    const reasons = Object.fromEntries(Object.entries(s.violations).map(([id, x]) => [id, x.status === "excluded" ? [x.basic, x.reason] : x.status]));
    expect(reasons).toEqual({
      [placard.id]: ["hm_compliance", "hm_not_placardable"],
      [unknown.id]: [null, "not_in_appendix"],
      [blank.id]: [null, "not_in_appendix"],
      [dismissed.id]: ["hos_compliance", "dismissed"],
    });
    expect(s.basics).toEqual([]);
  });

  it("leaves out a vehicle defect on a driver-only inspection and a moving violation on a post-crash one", () => {
    const defect = v("393.45");
    expect(score(insp([defect], { level: 3 })).violations[defect.id]).toMatchObject({ status: "excluded", reason: "level_not_relevant" });
    const lane = v("392.2LC");
    const log = v("395.8(e)");
    const crash = score(insp([lane, log], { postAccident: true }));
    expect(crash.violations[lane.id]).toMatchObject({ status: "excluded", basic: "unsafe_driving", reason: "crash_related" });
    expect(crash.violations[log.id]).toMatchObject({ status: "scored", points: 21 });
  });

  it("scores a conviction on a different charge at severity 1 with no out-of-service weight", () => {
    const a = v("393.75A3-TAOL", true, 2);
    expect(score(insp([a])).violations[a.id]).toEqual({ status: "scored", basic: "vehicle_maintenance", severityWeight: 1, oosWeight: 0, timeWeight: 3, points: 3 });
  });

  it("counts a repeated code once, on the first occurrence's line", () => {
    const first = v("393.47(a)");
    const again = v("393.47(a)", true);
    const s = score(insp([first, again]));
    // The repeat's OOS order makes the one line out of service (§3: OOS if any occurrence was).
    expect(s.violations[first.id]).toMatchObject({ status: "scored", oosWeight: 2, points: 18 });
    expect(s.violations[again.id]).toEqual({ status: "excluded", basic: "vehicle_maintenance", reason: "counted_once" });
  });

  it("gives every violation the inspection's own reason when the whole inspection no longer counts, or does not yet", () => {
    const old = v("393.45");
    const aged = score(insp([old], { date: "2024-09-30", mcmisAddDate: "20241001 0800" }));
    expect([aged.timeWeight, aged.basics, aged.violations[old.id]]).toEqual([null, [], { status: "excluded", basic: "vehicle_maintenance", reason: "outside_window" }]);
    const fresh = v("393.45");
    const loading = score(insp([fresh], { date: "2026-10-13", mcmisAddDate: "20261014 0215" }));
    expect(loading.violations[fresh.id]).toMatchObject({ status: "excluded", reason: "not_loaded" });
  });

  it("reads a record without its MCMIS load date as loaded — FMCSA's feed served it, so MCMIS had it", () => {
    const a = v("393.45");
    expect(score(insp([a], { mcmisAddDate: null })).violations[a.id]).toMatchObject({ status: "scored" });
  });

  it("scores nothing for an undated inspection rather than calling it too old", () => {
    expect(inspectionSms(insp([v("393.45")], { date: null }), TODAY)).toBeNull();
  });
});
