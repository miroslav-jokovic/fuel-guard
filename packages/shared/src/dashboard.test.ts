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
    expect(csv).toBe('A,B\r\nx,"has, comma"\r\n"q""q",ok');
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
    // ⚠ `+2` and `-3` are NUMBERS and pass through unguarded since FUEL-P2 unified the two cell rules
    // — a leading sign followed by digits is arithmetic, not an injection vector, and neutralising it
    // turns every negative dollar figure in a report into text the column cannot sum. `'=1+1` and
    // `'@SUM` are the cells the S-1 guard exists for and they are still defused.
    expect(csv).toBe("A,B\r\n'=1+1,+2\r\n'@SUM,-3");
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

  it("zero-fills missing days in the spend trend", () => {
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
  });

  it("falls back to UTC slicing for an unknown timezone (deterministic, no throw)", () => {
    const s = aggregateDashboard([txn("t1", "2026-06-02T00:00:00.000Z", 100)], [], [], [], { tz: "Not/AZone" });
    expect(s.spendTrend).toEqual([{ date: "2026-06-02", value: 100 }]);
  });
});

/**
 * The corrupt-MPG guard MOVED, it was not deleted (M4, D-MPG1).
 *
 * This file used to prove that a fill with `computed_mpg` 0.5 or 250 could not drag the dashboard's
 * efficiency figure. It no longer can, because the dashboard no longer HAS one: fleet MPG comes from
 * `GET /api/fueling/fleet-mpg`, whose numerator is two odometer readings rather than a ratio taken
 * back out of the fuel, and the band that guarded it is proved in `fleetEfficiency.test.ts`
 * ("drops a fill whose stored MPG is outside the per-fill band, and says how much fuel that cost").
 *
 * What must still be true HERE is the other half of that old guard, and it is the half a refactor
 * could break silently: a corrupt fill is corrupt for EFFICIENCY only. Its gallons were bought and
 * its money was spent, and dropping it from spend would understate a fuel bill to tidy an MPG.
 */
describe("aggregateDashboard — a corrupt-MPG fill is still fuel that was bought", () => {
  const t = (id: string, day: string, gallons: number, mpg: number | null): FuelTransaction =>
    ({ id, org_id: "o", vehicle_id: "v1", driver_id: "d1", fueled_at: `2026-06-${day}T12:00:00Z`, odometer: null,
       gallons, price_per_gal: null, total_cost: gallons * 4, location_text: null, source: "fuel_card",
       computed_mpg: mpg, has_anomaly: false, max_severity: null, ai_risk_level: null, created_at: `2026-06-${day}T12:00:00Z` } as FuelTransaction);

  it("counts corrupt-MPG fills in spend and gallons", () => {
    const s = aggregateDashboard([t("t1", "01", 100, 0.5)], [], [], []);
    expect(s.totalGallons).toBe(100);
    expect(s.totalSpend).toBe(400);
  });
});

describe("aggregateDashboard extras (idle / reefer / coverage / declines)", () => {
  it("splits reefer spend and computes idle, coverage, and declines", () => {
    const rows = [
      txn({ id: "x1", total_cost: 300, tank_type: "tractor", samsara_recon_at: "2026-06-01T12:00:00Z" }),
      txn({ id: "x2", total_cost: 100, tank_type: "reefer", samsara_recon_at: null }),
    ];
    const s = aggregateDashboard(rows, [], vehicles, drivers, {}, {
      idleHours: 1.5,
      idleCostUsd: 30,
      declinedCount: 4,
    });
    expect(s.reeferSpend).toBe(100);
    expect(s.idleCostUsd).toBe(30);
    expect(s.idleHours).toBe(1.5);
    expect(s.movingSpend).toBe(270); // tractor 300 - idle 30
    expect(s.coveragePct).toBe(50); // 1 of 2 fills corroborated
    expect(s.declinedCount).toBe(4);
  });
});

describe("aggregateDashboard current-state alert attribution", () => {
  it("resolves risk-list drivers via anomalyDrivers when the flagged fill is outside the range", () => {
    const anoms = [
      { id: "a1", transaction_id: "old-txn", vehicle_id: "v1", severity: "critical", status: "open" },
    ] as never[];
    const s = aggregateDashboard([], anoms, vehicles, drivers, {}, {
      anomalyDrivers: new Map([["old-txn", "d1"]]),
    });
    expect(s.openAnomalies).toBe(1);
    expect(s.topVehiclesByRisk[0]).toMatchObject({ id: "v1", criticalCount: 1 });
    // Before the map existed this driver was silently DROPPED (their fill wasn't in the range).
    expect(s.topDriversByRisk[0]).toMatchObject({ id: "d1", anomalyCount: 1 });
  });
});
