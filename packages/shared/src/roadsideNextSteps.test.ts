import { describe, expect, it } from "vitest";
import { attributionAnswer, attributionQuestion, roadsideNextSteps, roadsideOpenSteps, roadsideWork } from "./roadsideNextSteps.js";
import type { RoadsideAttributionDto, RoadsideAttributionReadingDto } from "./roadsideAttributionContract.js";
import type { RoadsideRepairCertificationDto, RoadsideRepairDto } from "./roadsideRepairContract.js";
import type { RoadsideReportCheckDto } from "./roadsideReportCheckContract.js";

const SMITH = { id: "d-1", name: "John Smith" };

function reading(over: Partial<RoadsideAttributionReadingDto> = {}): RoadsideAttributionReadingDto {
  return {
    id: "a-1",
    engineVersion: "ic5.1",
    readAt: "2026-10-15T00:00:00Z",
    outcome: "one_driver",
    confidence: "high",
    basis: "covering",
    zone: "America/Chicago",
    zoneMethod: "gps",
    startedAt: null,
    endedAt: null,
    locationCheck: "confirmed",
    samsaraDriver: { id: "s-1", name: "John Smith" },
    driver: SMITH,
    candidates: [],
    ...over,
  };
}
const attribution = (over: Partial<RoadsideAttributionDto> = {}): RoadsideAttributionDto => ({
  reading: reading(),
  decision: null,
  basedOn: "a-1",
  reports: [],
  ...over,
});
const report = (over: Partial<RoadsideReportCheckDto> = {}): RoadsideReportCheckDto => ({
  documentId: "doc-1",
  state: "checked",
  outcome: "confirmed",
  reasons: [],
  nameOnReport: null,
  licenceLast4: null,
  driver: null,
  checkedAt: null,
  ...over,
});
function repair(over: Partial<RoadsideRepairDto> = {}): RoadsideRepairDto {
  return {
    unitId: "u-1",
    unit: { seq: 1, kind: "tractor", companyNumber: "612" },
    violations: [{ code: "39375A3", description: "Tire" }],
    dueOn: "2026-10-29",
    proposal: { outcome: "several_candidates", candidates: [], readAt: "2026-10-15T00:00:00Z" },
    decision: null,
    basedOn: "r-1",
    ...over,
  };
}
const accepted: RoadsideRepairDto["decision"] = {
  outcome: "accepted",
  workOrder: { workOrderId: "wo-1", reference: "WO-4471", openedOn: "2026-10-15", status: "COMPLETED", completedAt: null, description: null, jobs: [] },
  note: null,
  decidedBy: "Pat Lee",
  decidedAt: "2026-10-16T00:00:00Z",
};
const cert = (current: boolean): RoadsideRepairCertificationDto => ({
  id: "c-1",
  signerName: "Jane Doe",
  signerTitle: "Safety Director",
  signedOn: "2026-10-17",
  certifiedAt: "2026-10-17T00:00:00Z",
  documentId: "doc-9",
  current,
});

const TODAY = "2026-10-19";
const steps = (over: Partial<Parameters<typeof roadsideNextSteps>[0]> = {}) =>
  roadsideNextSteps({ attribution: attribution(), inspectionDate: "2026-10-06", repairs: [], certification: null, today: TODAY, ...over });

describe("who was driving (IC13, Q-IC15 (b))", () => {
  it("shows a strong reading of a roster driver as the answer, labelled as Samsara's, and asks nothing", () => {
    expect(attributionQuestion(attribution())).toBeNull();
    expect(steps()).toEqual([
      expect.objectContaining({ key: "driver", state: "done", title: "Driver: John Smith", detail: "from Samsara" }),
    ]);
  });

  it("asks for a weak reading, several drivers, nobody, a driver not on the roster, and another state", () => {
    expect(attributionQuestion(attribution({ reading: reading({ confidence: "low", basis: "before_only" }) }))?.reason).toBe("weak");
    expect(attributionQuestion(attribution({ reading: reading({ outcome: "several_drivers", confidence: null }) }))?.reason).toBe("outcome");
    expect(attributionQuestion(attribution({ reading: reading({ outcome: "no_assignment", confidence: null, samsaraDriver: null, driver: null }) }))?.reason).toBe("outcome");
    expect(attributionQuestion(attribution({ reading: reading({ driver: null }) }))).toEqual({
      reason: "not_on_roster",
      text: "Samsara names John Smith, who is not on our roster.",
    });
    expect(attributionQuestion(attribution({ reading: reading({ locationCheck: "other_state" }) }))?.reason).toBe("other_state");
  });

  it("asks when an officer's report disagrees, however strong Samsara reads", () => {
    const a = attribution({ reports: [report({ outcome: "needs_review" })] });
    expect(attributionQuestion(a)?.reason).toBe("report_disagrees");
    // A report still being read is not a disagreement.
    expect(attributionQuestion(attribution({ reports: [report({ state: "reading", outcome: null })] }))).toBeNull();
  });

  it("waits, with nothing to answer, before Samsara has been read", () => {
    expect(steps({ attribution: attribution({ reading: null, basedOn: null }) })[0]).toMatchObject({ key: "driver", state: "waiting" });
  });

  it("offers the officer's report as the way to settle an open question, until one is filed", () => {
    const weak = reading({ confidence: "low", basis: "after_only" });
    expect(steps({ attribution: attribution({ reading: weak }) })[0]!.detail).toMatch(/Uploading the officer's report can settle it/);
    expect(steps({ attribution: attribution({ reading: weak, reports: [report({ state: "reading", outcome: null })] }) })[0]!.detail).not.toMatch(/Uploading/);
  });

  it("names who settled it once a person or the report decided, and never asks over a decision", () => {
    const weak = reading({ confidence: "low" });
    const byPerson = attribution({ reading: weak, decision: { id: "p", kind: "confirmed", driver: null, decidedBy: "Jane Doe", decidedAt: "x", note: null, engineVersion: "ic5.1" } });
    expect(attributionQuestion(byPerson)).toBeNull();
    expect(steps({ attribution: byPerson })[0]).toMatchObject({ state: "done", title: "Driver: John Smith", detail: "confirmed by Jane Doe" });
    const byReport = attribution({ decision: { id: "p", kind: "confirmed_by_report", driver: SMITH, decidedBy: null, decidedAt: "x", note: null, engineVersion: "ic5.1" } });
    expect(steps({ attribution: byReport })[0]!.detail).toBe("confirmed by the officer's report");
    const corrected = attribution({ decision: { id: "p", kind: "corrected", driver: { id: "d-2", name: "Ann Roe" }, decidedBy: "Jane Doe", decidedAt: "x", note: "log", engineVersion: "ic5.1" } });
    expect(steps({ attribution: corrected })[0]).toMatchObject({ title: "Driver: Ann Roe", detail: "corrected by Jane Doe" });
  });
});

describe("an older inspection's driver (DRIVER_ASK_DAYS)", () => {
  it("asks for 90 days, then waits for the DataQs filing rather than filling Needs action", () => {
    const weak = attribution({ reading: reading({ confidence: "low", basis: "after_only" }) });
    expect(steps({ attribution: weak, inspectionDate: "2026-07-21" })[0]!.state).toBe("open");
    const old = steps({ attribution: weak, inspectionDate: "2026-07-20" })[0]!;
    expect(old.state).toBe("waiting");
    expect(old.detail).toMatch(/confirmed when a DataQs request is prepared/);
    expect(steps({ attribution: weak, inspectionDate: null })[0]!.state).toBe("waiting");
  });
});

describe("who the record names as the driver", () => {
  it("is the decision's driver, else Samsara's one driver, saying on whose word", () => {
    expect(attributionAnswer(attribution())).toEqual({ name: "John Smith", by: "samsara" });
    expect(attributionAnswer(attribution({ reading: reading({ driver: null }) }))).toEqual({ name: "John Smith", by: "samsara" });
    expect(attributionAnswer(attribution({ reading: reading({ outcome: "several_drivers" }) }))).toBeNull();
    const corrected = attribution({ decision: { id: "p", kind: "corrected", driver: { id: "d-2", name: "Ann Roe" }, decidedBy: "J", decidedAt: "x", note: "n", engineVersion: "ic5.1" } });
    expect(attributionAnswer(corrected)).toEqual({ name: "Ann Roe", by: "person" });
    const byReport = attribution({ decision: { id: "p", kind: "confirmed_by_report", driver: SMITH, decidedBy: null, decidedAt: "x", note: null, engineVersion: "ic5.1" } });
    expect(attributionAnswer(byReport)).toEqual({ name: "John Smith", by: "report" });
  });
});

describe("the repair, the report and the certification (IC11, 396.9(d))", () => {
  it("asks nothing about repairs or the report on an inspection with no vehicle repair", () => {
    expect(steps().map((s) => s.key)).toEqual(["driver"]);
  });

  it("gives maintenance one open step per unit with the clock, and holds the certification until all are named", () => {
    const out = steps({ repairs: [repair(), repair({ unitId: "u-2", unit: { seq: 2, kind: "trailer", companyNumber: "T88" }, proposal: { outcome: "repaired_at_scene", candidates: [], readAt: "x" } })] });
    expect(out.find((s) => s.key === "repair:u-1")).toMatchObject({ owner: "maintenance", state: "open", title: "Truck 612: name the repair", dueOn: "2026-10-29", clock: { overdue: false, days: 10 } });
    expect(out.find((s) => s.key === "repair:u-2")).toMatchObject({ state: "done", title: "Trailer T88: repaired at the scene", clock: null });
    expect(out.find((s) => s.key === "certify")).toMatchObject({ owner: "safety", state: "waiting" });
    expect(out.find((s) => s.key === "report")).toMatchObject({ owner: "safety", state: "open" });
  });

  it("opens the certification for safety once every unit is settled, and closes it while the certification stands", () => {
    const settled = [repair({ decision: accepted })];
    expect(steps({ repairs: settled }).find((s) => s.key === "certify")).toMatchObject({ state: "open", title: "Certify the repairs" });
    expect(steps({ repairs: settled }).find((s) => s.key === "repair:u-1")!.title).toBe("Truck 612: repaired under FleetPal work order WO-4471");
    expect(steps({ repairs: settled, certification: cert(true) }).find((s) => s.key === "certify")).toMatchObject({ state: "done", title: "Repairs certified by Jane Doe" });
    expect(steps({ repairs: settled, certification: cert(false) }).find((s) => s.key === "certify")).toMatchObject({ state: "open", title: "Certify the repairs again" });
  });

  it("closes the report step once one is filed", () => {
    const out = steps({ repairs: [repair()], attribution: attribution({ reports: [report()] }) });
    expect(out.find((s) => s.key === "report")).toMatchObject({ state: "done" });
  });
});

describe("the order and the count", () => {
  it("puts open steps first, the most overdue first, then waiting, then done", () => {
    const out = steps({
      attribution: attribution({ reading: reading({ confidence: "low" }) }),
      repairs: [repair({ unitId: "u-1", dueOn: "2026-10-25" }), repair({ unitId: "u-2", dueOn: "2026-10-10" })],
    });
    expect(out.map((s) => `${s.key}:${s.state}`)).toEqual(["repair:u-2:open", "repair:u-1:open", "driver:open", "report:open", "certify:waiting"]);
    expect(out[0]!.clock).toEqual({ overdue: true, days: 9 });
  });

  it("counts open steps by owner", () => {
    const out = steps({ attribution: attribution({ reading: reading({ confidence: "low" }) }), repairs: [repair()] });
    expect(roadsideOpenSteps(out)).toEqual({ total: 3, byOwner: { safety: 2, maintenance: 1 } });
    expect(roadsideOpenSteps(steps())).toEqual({ total: 0, byOwner: { safety: 0, maintenance: 0 } });
  });
});

describe("one inspection's line of work (the inbox)", () => {
  it("names the first open step, the driver and the verified points only", () => {
    const s = steps({ attribution: attribution({ reading: reading({ confidence: "low" }) }), repairs: [repair({ dueOn: "2026-10-10" })] });
    const w = roadsideWork("i-1", s, attribution(), { basics: [
      { basic: "vehicle_maintenance", verified: true, severitySum: 20, capped: 20, points: 60 },
      { basic: "hm_compliance", verified: false },
      { basic: "unsafe_driving", verified: true, severitySum: 1, capped: 1, points: 3 },
    ] });
    expect(w).toEqual({
      id: "i-1",
      driver: { name: "John Smith", by: "samsara" },
      open: { total: 3, byOwner: { safety: 2, maintenance: 1 } },
      next: { title: "Truck 612: name the repair", owner: "maintenance", dueOn: "2026-10-10", clock: { overdue: true, days: 9 } },
      points: 63,
      awaitsReport: true,
      categories: [],
    });
    expect(roadsideWork("i-2", steps(), attribution(), null)).toMatchObject({ next: null, points: null, open: { total: 0 }, awaitsReport: false });
  });
});
