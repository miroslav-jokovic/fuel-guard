import { describe, it, expect } from "vitest";
import { driverAlertRows, planFileAlerts, unitAlertRows, type FileAlert } from "./dqAlerts.js";
import type { DriverOverviewRow, DqAttentionItem } from "./dqFile.js";
import type { UnitFileRow } from "./unitFileContract.js";
import type { UnitAttentionItem } from "./unitFile.js";

/**
 * C3 — the alert schedule's dedupe design, exhaustively. Every case here is a way a notification
 * channel dies: double-sends after restarts, five alerts for one new item, daily overdue nagging,
 * or alerts about people who left.
 */
const TODAY = "2026-08-19";

const attention = (over: Partial<DqAttentionItem>): DqAttentionItem => ({
  key: "medical_card",
  label: "Medical examiner's certificate",
  citation: "49 CFR §391.43",
  group: "medical",
  state: "expiring",
  goodUntil: "2026-09-01",
  evidenceDate: null,
  daysRemaining: 13,
  ...over,
});

const driver = (over: Partial<DriverOverviewRow> = {}, items: DqAttentionItem[] = []): DriverOverviewRow => ({
  driver_id: "d1",
  driver_name: "Marcus Reyes",
  driver_status: "active",
  state: "incomplete",
  counts: { current: 0, expiring: 0, expired: 0, missing: 0 },
  groups: [],
  attention: items,
  requirements: [],
  documents: { onFile: 0, of: 0 },
  ...over,
});

const plan = (rows: DriverOverviewRow[], sent: string[] = []): FileAlert[] =>
  planFileAlerts(driverAlertRows(rows), TODAY, new Set(sent));

describe("planFileAlerts, a driver — threshold crossings", () => {
  it("an item at exactly 60 days emits the 60 key", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 60 })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(60);
    expect(out[0]!.dedupeKey).toBe("dq:d1:medical_card:2026-09-01:60");
    expect(out[0]!.legacyDedupeKey).toBe("dq:d1:medical_card:60");
    expect(out[0]!.category).toBe("dq_expiring");
  });

  it("at 59 days it does NOT re-emit once the 60 key was sent", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 59 })])], ["dq:d1:medical_card:2026-09-01:60"]);
    expect(out).toHaveLength(0);
  });

  it("crossing the next threshold emits again — 30 fires even though 60 was sent", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 30 })])], ["dq:d1:medical_card:2026-09-01:60"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(30);
  });

  it("an item FIRST seen at 10 days emits ONE alert (the 14 key), never a backlog of five", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 10 })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(14);
    expect(out[0]!.severity).toBe("warning");
  });

  it("expiring today emits the 0 key with a today title", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 0 })])]);
    expect(out[0]!.threshold).toBe(0);
    expect(out[0]!.title).toContain("expires today");
  });

  it("91 days out is not yet news", () => {
    expect(plan([driver({}, [attention({ daysRemaining: 91 })])])).toHaveLength(0);
  });

  it("far-out thresholds are informational, near ones are warnings", () => {
    const far = plan([driver({}, [attention({ daysRemaining: 88 })])]);
    expect(far[0]!.severity).toBe("info");
  });
});

describe("planFileAlerts, a driver — renewal and the key-format transition (Q11, 2026-10-05)", () => {
  it("a renewed item alerts again: last cycle's key does not silence the new expiry date", () => {
    const out = plan(
      [driver({}, [attention({ goodUntil: "2027-09-01", daysRemaining: 60 })])],
      ["dq:d1:medical_card:2026-09-01:60"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.dedupeKey).toBe("dq:d1:medical_card:2027-09-01:60");
  });

  it("an old-format key the caller vouches for (sent this cycle) still counts as sent", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 59 })])], ["dq:d1:medical_card:60"]);
    expect(out).toHaveLength(0);
  });

  it("overdue keys carry no legacy twin — their format did not change", () => {
    const out = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])]);
    expect(out[0]!.legacyDedupeKey).toBeUndefined();
  });
});

describe("planFileAlerts, a driver — overdue weekly cadence", () => {
  it("an overdue item emits with a week-bucketed key and dq_expired", () => {
    const out = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("dq_expired");
    expect(out[0]!.dedupeKey).toMatch(/^dq:d1:medical_card:overdue:\d+$/);
    expect(out[0]!.title).toContain("expired 3 days ago");
  });

  it("re-running within the same week is silent; the key is deterministic", () => {
    const first = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])]);
    const again = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])], [first[0]!.dedupeKey]);
    expect(again).toHaveLength(0);
  });

  it("a NEW week emits again — weekly, not once-ever", () => {
    const thisWeek = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])])[0]!.dedupeKey;
    const nextWeek = planFileAlerts(
      driverAlertRows([driver({}, [attention({ daysRemaining: -10, state: "expired" })])]),
      "2026-08-26",
      new Set([thisWeek]),
    );
    expect(nextWeek).toHaveLength(1);
    expect(nextWeek[0]!.dedupeKey).not.toBe(thisWeek);
  });
});

describe("planFileAlerts, a driver — who and what never alerts", () => {
  it("a terminated driver emits nothing", () => {
    const out = plan([
      driver({ driver_status: "terminated" }, [attention({ daysRemaining: -3, state: "expired" })]),
    ]);
    expect(out).toHaveLength(0);
  });

  it("undated (missing) items emit nothing — the strip and the digest carry those", () => {
    const out = plan([driver({}, [attention({ state: "missing", goodUntil: null, daysRemaining: null })])]);
    expect(out).toHaveLength(0);
  });

  it("output is worst first: overdue before due-soon", () => {
    const out = plan([
      driver({}, [
        attention({ key: "cdl", label: "CDL", daysRemaining: 12 }),
        attention({ daysRemaining: -5, state: "expired" }),
      ]),
    ]);
    expect(out.map((a) => a.itemKey)).toEqual(["medical_card", "cdl"]);
  });

  it("two drivers with the same item get distinct keys", () => {
    const out = plan([
      driver({}, [attention({ daysRemaining: 14 })]),
      driver({ driver_id: "d2", driver_name: "Dana Ellis" }, [attention({ daysRemaining: 14 })]),
    ]);
    expect(new Set(out.map((a) => a.dedupeKey)).size).toBe(2);
  });
});

describe("planFileAlerts, a driver — the ledger's keys do not move (UNIT-FILES-PLAN UF6)", () => {
  // Golden strings: every key below is one the ledger already holds for a driver alert sent before
  // UF6. A changed character re-sends every expiry the office has already been told about.
  it("a driver's threshold, legacy and overdue keys, titles and categories are byte for byte C3's", () => {
    const due = plan([driver({}, [attention({ daysRemaining: 14 })])])[0]!;
    expect(due.dedupeKey).toBe("dq:d1:medical_card:2026-09-01:14");
    expect(due.legacyDedupeKey).toBe("dq:d1:medical_card:14");
    expect(due.category).toBe("dq_expiring");
    expect(due.title).toBe("Marcus Reyes — Medical examiner's certificate expires in 14 days");
    const late = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])])[0]!;
    expect(late.dedupeKey).toBe("dq:d1:medical_card:overdue:2954");
    expect(late.category).toBe("dq_expired");
  });
});

describe("planFileAlerts, a truck or trailer (UNIT-FILES-PLAN UF6)", () => {
  const unit = (over: Partial<UnitFileRow> = {}, items: UnitAttentionItem[] = []): UnitFileRow => ({
    subject_type: "tractor",
    subject_id: "v1",
    unit_number: "1042",
    status: "active",
    ownership: "owned",
    state: "incomplete",
    counts: { current: 0, expiring: 0, expired: 0, missing: 0 },
    ownership_unknown: [],
    attention: items,
    items: [],
    papers: [],
    paper_count: 0,
    ...over,
  });
  const reg = (over: Partial<UnitAttentionItem> = {}): UnitAttentionItem => ({
    key: "registration",
    label: "Registration",
    citation: "State law",
    group: "registration",
    state: "expiring",
    goodUntil: "2026-09-18",
    evidenceDate: null,
    daysRemaining: 30,
    ...over,
  });
  const planUnits = (rows: UnitFileRow[], sent: string[] = []): FileAlert[] =>
    planFileAlerts(unitAlertRows(rows), TODAY, new Set(sent));

  it("a unit at 30 days alerts once, under its own key and category, and not again on the next run", () => {
    const first = planUnits([unit({}, [reg()])]);
    expect(first).toHaveLength(1);
    expect(first[0]!.dedupeKey).toBe("unit:tractor:v1:registration:2026-09-18:30");
    expect(first[0]!.legacyDedupeKey).toBeUndefined();
    expect(first[0]!.category).toBe("unit_file_expiring");
    expect(first[0]!.title).toBe("Truck 1042 — Registration expires in 30 days");
    expect(planUnits([unit({}, [reg({ daysRemaining: 29 })])], [first[0]!.dedupeKey])).toHaveLength(0);
  });

  it("a trailer is named a trailer, and its overdue paper is unit_file_expired with a trailer key", () => {
    const out = planUnits([unit({ subject_type: "trailer", subject_id: "t1", unit_number: "5310" }, [reg({ daysRemaining: -2, state: "expired" })])]);
    expect(out[0]!.category).toBe("unit_file_expired");
    expect(out[0]!.dedupeKey).toMatch(/^unit:trailer:t1:registration:overdue:\d+$/);
    expect(out[0]!.title).toBe("Trailer 5310 — Registration expired 2 days ago");
  });

  it("an inactive unit does not alert — retired or not yet delivered", () => {
    for (const status of ["retired", "ordered"]) {
      expect(planUnits([unit({ status }, [reg({ daysRemaining: -2, state: "expired" })])])).toHaveLength(0);
    }
    // In the shop is in service: it is still inspected and registered.
    expect(planUnits([unit({ status: "maintenance" }, [reg()])])).toHaveLength(1);
  });

  it("a truck and a driver with the same id never share a key", () => {
    const keys = [
      ...planUnits([unit({ subject_id: "x" }, [reg({ key: "medical_card", daysRemaining: 14 })])]),
      ...plan([driver({ driver_id: "x" }, [attention({ daysRemaining: 14 })])]),
    ].map((a) => a.dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });
});
