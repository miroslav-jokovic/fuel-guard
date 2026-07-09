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
  it("neutralizes CSV formula injection in untrusted cells (S-1)", () => {
    const csv = toCsv(
      [{ a: "=1+1", b: "+2" }, { a: "@SUM", b: "-3" }],
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
    );
    // Each dangerous leading char (= + - @) gets a defusing apostrophe so Excel/Sheets won't execute it.
    expect(csv).toBe("A,B\n'=1+1,'+2\n'@SUM,'-3");
  });
});

describe("aggregateDashboard — org-timezone bucketing + zero-fill (fix #4)", () => {
  const txn = (id: string, fueledAt: string, cost: number): FuelTransaction =>
    ({ id, org_id: "o", vehicle_id: "v1", driver_id: "d1", fueled_at: fueledAt, odometer: null,
       gallons: 10, price_per_gal: null, total_cost: cost, location_text: null, source: "fuel_card",
       computed_mpg: null, has_anomaly: false, max_severity: null, ai_risk_level: null, created_at: fueledAt } as FuelTransaction);

  it("buckets an evening Central fill on its LOCAL day, not the UTC day", () => {
    // 7pm Chicago on Jun 1 = 00:00Z Jun 2. UTC slicing put this on Jun 2 — wrong for the org.
    const s = aggregateDashboard([txn("t1", "2026-06-02T00:00:00.000Z", 100)], [], [], [], { tz: "America/Chicago" });
    expect(s.spendTrend).toEqual([{ date: "2026-06-01", value: 100 }]);
  });

  it("zero-fills missing days in the spend trend and null-gaps the MPG trend", () => {
    const s = aggregateDashboard(
      [txn("t1", "2026-06-01T12:00:00.000Z", 100), txn("t2", "2026-06-04T12:00:00.000Z", 50)],
      [], [], [],
    );
    expect(s.spendTrend).toEqual([
      { date: "2026-06-01", value: 100 },
      { date: "2026-06-02", value: 0 },
      { date: "2026-06-03", value: 0 },
      { date: "2026-06-04", value: 50 },
    ]);
    expect(s.mpgTrend.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]);
    expect(s.mpgTrend.every((p) => p.value === null)).toBe(true); // no computed_mpg in fixture
  });

  it("falls back to UTC slicing for an unknown timezone (deterministic, no throw)", () => {
    const s = aggregateDashboard([txn("t1", "2026-06-02T00:00:00.000Z", 100)], [], [], [], { tz: "Not/AZone" });
    expect(s.spendTrend).toEqual([{ date: "2026-06-02", value: 100 }]);
  });
});

describe("aggregateDashboard — corrupt-MPG guard (dashboard fix)", () => {
  const t = (id: string, day: string, gallons: number, mpg: number | null): FuelTransaction =>
    ({ id, org_id: "o", vehicle_id: "v1", driver_id: "d1", fueled_at: `2026-06-${day}T12:00:00Z`, odometer: null,
       gallons, price_per_gal: null, total_cost: gallons * 4, location_text: null, source: "fuel_card",
       computed_mpg: mpg, has_anomaly: false, max_severity: null, ai_risk_level: null, created_at: `2026-06-${day}T12:00:00Z` } as FuelTransaction);

  it("excludes a nonsense sub-1 MPG from the daily trend (no false dip)", () => {
    // A bad odometer produced computed_mpg 0.5 on the 30th; the day should read as a gap, not ~0.5.
    const s = aggregateDashboard([t("t1", "30", 100, 0.5)], [], [], []);
    expect(s.mpgTrend.at(-1)).toEqual({ date: "2026-06-30", value: null });
    expect(s.fleetMpg).toBeNull(); // the only fill was corrupt → no fleet MPG
  });

  it("excludes an absurd high MPG but keeps the real one", () => {
    const s = aggregateDashboard([t("t1", "01", 100, 6.5), t("t2", "02", 80, 250)], [], [], []);
    expect(s.mpgTrend[0]).toEqual({ date: "2026-06-01", value: 6.5 });
    expect(s.mpgTrend[1]).toEqual({ date: "2026-06-02", value: null }); // 250 mpg dropped
    expect(s.fleetMpg).toBe(6.5); // corrupt value excluded from the weighted average
  });

  it("still counts corrupt-MPG fills in spend and gallons (only efficiency is guarded)", () => {
    const s = aggregateDashboard([t("t1", "01", 100, 0.5)], [], [], []);
    expect(s.totalGallons).toBe(100);
    expect(s.totalSpend).toBe(400);
  });
});
