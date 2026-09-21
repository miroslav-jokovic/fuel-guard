import { describe, expect, it } from "vitest";
import {
  aggregateDashboard,
  measureDashboard,
  summariseDashboard,
  type DashboardMeasurements,
  type DashboardTransaction,
} from "./dashboard.js";

/**
 * The verdict half of queue item 5 (Q8, `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * `dashboard.test.ts` covers the row path end to end and keeps doing so. What is only testable here
 * is that the SAME verdicts are applied to measurements that arrived from SQL, because that is the
 * path the Dashboard takes from step 3 onward and no fixture of rows exercises it.
 */
const EMPTY: DashboardMeasurements = {
  totalSpend: 0,
  totalGallons: 0,
  reeferSpend: 0,
  coveredTxns: 0,
  totalTxns: 0,
  spendByDay: [],
  severityCounts: {},
  openAnomalies: 0,
  topVehiclesByRisk: [],
  topDriversByRisk: [],
  idleSec: 0,
};

const measured = (over: Partial<DashboardMeasurements>): DashboardMeasurements => ({ ...EMPTY, ...over });

describe("summariseDashboard", () => {
  it("zero-fills the gap BETWEEN spending days and does not pad beyond them", () => {
    const s = summariseDashboard(
      measured({ spendByDay: [{ date: "2026-09-03", value: 120 }, { date: "2026-09-01", value: 80 }] }),
    );
    expect(s.spendTrend).toEqual([
      { date: "2026-09-01", value: 80 },
      { date: "2026-09-02", value: 0 }, // a no-spend day inside the period is a real $0 day
      { date: "2026-09-03", value: 120 },
    ]);
  });

  // SQL hands back only the severities that occurred; the four keys the donut binds to are the
  // verdict's job, and a missing one is a 0 rather than an absent key that renders as blank.
  it("fills the severities SQL did not mention with zeroes", () => {
    const s = summariseDashboard(measured({ severityCounts: { critical: 2 }, openAnomalies: 2 }));
    expect(s.anomaliesBySeverity).toEqual({ low: 0, medium: 0, high: 0, critical: 2 });
  });

  it("prices idle from seconds and the basis, and floors moving spend at zero", () => {
    const s = summariseDashboard(measured({ totalSpend: 100, reeferSpend: 10, idleSec: 3600 }), {
      costBasis: { idleGalPerHour: 2, fuelPricePerGal: 60 }, // $120/h against $90 of tractor spend
    });
    expect(s.idleHours).toBe(1);
    expect(s.idleCostUsd).toBe(120);
    expect(s.movingSpend).toBe(0); // never negative — idle cost is an estimate, tractor spend is a fact
  });

  it("reports no idle dollars when no basis was supplied, rather than pricing it at zero silently", () => {
    const s = summariseDashboard(measured({ idleSec: 7200 }));
    expect(s.idleHours).toBe(2);
    expect(s.idleCostUsd).toBe(0);
  });

  it("answers null for coverage when there is nothing to divide, and never 0", () => {
    expect(summariseDashboard(EMPTY).coveragePct).toBeNull();
    expect(summariseDashboard(EMPTY).allTimeCoveragePct).toBeNull();
    expect(summariseDashboard(measured({ totalTxns: 4, coveredTxns: 1 })).coveragePct).toBe(25);
  });

  it("rounds money to cents, because SQL returns the measurement unrounded", () => {
    const s = summariseDashboard(measured({ totalSpend: 100.005, totalGallons: 12.3456, reeferSpend: 0.014 }));
    expect(s.totalSpend).toBe(100.01);
    expect(s.totalGallons).toBe(12.35);
    expect(s.reeferSpend).toBe(0.01);
  });

  it("passes the risk lists through as SQL ordered and cut them — the ranking is a measurement", () => {
    const rows = [{ id: "v1", label: "1207", anomalyCount: 3, criticalCount: 2 }];
    expect(summariseDashboard(measured({ topVehiclesByRisk: rows })).topVehiclesByRisk).toEqual(rows);
  });
});

/**
 * ⚠ The property that makes the move safe: the row path and the SQL path share the verdict. This
 * pins it structurally — fold rows to measurements, summarise them, and get exactly what the
 * one-call form returns.
 */
describe("measureDashboard + summariseDashboard === aggregateDashboard", () => {
  const txn = (id: string, at: string, cost: number, reefer = false): DashboardTransaction => ({
    id,
    vehicle_id: "v1",
    driver_id: "d1",
    fueled_at: at,
    gallons: 100,
    total_cost: cost,
    tank_type: reefer ? "reefer" : "tractor",
    samsara_recon_at: id === "t1" ? at : null,
  });
  const rows = [
    txn("t1", "2026-09-01T12:00:00.000Z", 300),
    txn("t2", "2026-09-03T12:00:00.000Z", 100, true),
  ];
  const anomalies = [
    { id: "a1", transaction_id: "t1", vehicle_id: "v1", severity: "critical" as const, status: "open" as const },
  ];
  const extra = { idleSec: 5400, costBasis: { idleGalPerHour: 2, fuelPricePerGal: 10 }, declinedCount: 4 };

  it("agrees on every field", () => {
    const vehicles = [{ id: "v1", unit_number: "1207" }];
    const drivers = [{ id: "d1", full_name: "Ana Ruiz" }];
    expect(
      summariseDashboard(measureDashboard(rows, anomalies, vehicles, drivers, { tz: "America/Chicago" }, extra), extra),
    ).toEqual(aggregateDashboard(rows, anomalies, vehicles, drivers, { tz: "America/Chicago" }, extra));
  });
});
