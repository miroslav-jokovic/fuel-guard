import { describe, it, expect } from "vitest";
import { aggregateDashboard, toCsv, type FuelTransaction, type Anomaly } from "./index.js";

function txn(over: Partial<FuelTransaction>): FuelTransaction {
  return {
    id: "t",
    org_id: "o",
    vehicle_id: "v1",
    driver_id: "d1",
    fueled_at: "2026-06-01T12:00:00Z",
    odometer: 1000,
    gallons: 100,
    price_per_gal: 4,
    total_cost: 400,
    location_text: null,
    source: "manual",
    computed_mpg: 6,
    has_anomaly: false,
    max_severity: null,
    ai_risk_level: null,
    created_at: "2026-06-01T12:00:00Z",
    ...over,
  };
}
function anom(over: Partial<Anomaly>): Anomaly {
  return {
    id: "a",
    org_id: "o",
    transaction_id: "t1",
    vehicle_id: "v1",
    rule_id: "mpg_deviation",
    severity: "high",
    status: "open",
    message: "m",
    evidence: {},
    source: "rules",
    assigned_to: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    version: 1,
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-06-01T12:00:00Z",
    ...over,
  };
}

const vehicles = [{ id: "v1", unit_number: "T-101" }];
const drivers = [{ id: "d1", full_name: "Marcus Reyes" }];

describe("aggregateDashboard", () => {
  const txns = [
    txn({ id: "t1", fueled_at: "2026-06-01T12:00:00Z", gallons: 100, total_cost: 400, computed_mpg: 6 }),
    txn({ id: "t2", fueled_at: "2026-06-02T12:00:00Z", gallons: 50, total_cost: 200, computed_mpg: 8 }),
  ];
  const anomalies = [
    anom({ id: "a1", transaction_id: "t1", severity: "critical", status: "open" }),
    anom({ id: "a2", transaction_id: "t2", severity: "high", status: "investigating" }),
    anom({ id: "a3", transaction_id: "t2", severity: "low", status: "resolved" }), // not open
    anom({ id: "a4", transaction_id: "t1", severity: "high", status: "superseded" }), // ignored
  ];

  const s = aggregateDashboard(txns, anomalies, vehicles, drivers);

  it("sums spend and gallons", () => {
    expect(s.totalSpend).toBe(600);
    expect(s.totalGallons).toBe(150);
  });
  it("computes a gallon-weighted fleet MPG", () => {
    // (6*100 + 8*50) / 150 = 6.67
    expect(s.fleetMpg).toBeCloseTo(6.67, 1);
  });
  it("counts only open/investigating anomalies", () => {
    expect(s.openAnomalies).toBe(2);
    expect(s.anomaliesBySeverity.critical).toBe(1);
    expect(s.anomaliesBySeverity.high).toBe(1);
    expect(s.anomaliesBySeverity.low).toBe(0);
  });
  it("builds daily trends", () => {
    expect(s.spendTrend).toEqual([
      { date: "2026-06-01", value: 400 },
      { date: "2026-06-02", value: 200 },
    ]);
    expect(s.mpgTrend.length).toBe(2);
  });
  it("ranks top vehicles by risk (critical first)", () => {
    expect(s.topVehiclesByRisk[0]?.label).toBe("T-101");
    expect(s.topVehiclesByRisk[0]?.criticalCount).toBe(1);
  });
});

describe("toCsv", () => {
  it("serializes with headers and RFC-4180 quoting", () => {
    const csv = toCsv(
      [{ a: "x", b: "has, comma" }, { a: 'q"q', b: "ok" }],
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
    );
    expect(csv).toBe('A,B\nx,"has, comma"\n"q""q",ok');
  });
  it("emits just the header for empty input", () => {
    expect(toCsv([], [{ key: "a", header: "A" }])).toBe("A");
  });
});
