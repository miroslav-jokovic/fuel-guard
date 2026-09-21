import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { __resetIdleCostBasisCache } from "../idle/index.js";
import { readDashboardSummary } from "./dashboardSummary.js";

/**
 * The assembly half of queue item 5 step 3. The arithmetic is proved pure in
 * `packages/shared/src/dashboardSummarise.test.ts`; what is only testable here is WHICH calls are
 * made, with which arguments — above all `p_org`, which is the tenant boundary for two
 * `security invoker` functions read with the service role (D-FC1).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const SUMMARY_ROW = {
  total_spend: "400.00",
  total_gallons: "100.5",
  reefer_spend: "100.00",
  covered_txns: 1,
  total_txns: 2,
  spend_by_day: [{ date: "2026-09-01", value: 300 }, { date: "2026-09-03", value: 100 }],
  severity_counts: { critical: 1, low: 2 },
  top_vehicles: [{ id: "v1", label: "1207", anomaly_count: 3, critical_count: 1 }],
  top_drivers: [{ id: "d1", label: "Ana Ruiz", anomaly_count: 2, critical_count: 0 }],
  open_anomalies: 3,
  idle_sec: "5400",
};

const COVERAGE_BUCKETS = [
  { month: "2026-08", attempted: true, status: "reconciled", fills: 30 },
  { month: "2026-08", attempted: true, status: "no_data", fills: 10 },
];

function recorder(over: { rpc?: Record<string, unknown>; declinedCount?: number } = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      declined_transactions: { count: over.declinedCount ?? 4 },
      idle_settings: [{ idle_gal_per_hour: "2.00", fuel_price_per_gal: "10.000" }],
      fuel_prices: [],
    },
    rpc: {
      dashboard_summary: [SUMMARY_ROW],
      telematics_coverage_buckets: COVERAGE_BUCKETS,
      ...over.rpc,
    },
  });
}

beforeEach(() => {
  __resetIdleCostBasisCache();
});

describe("readDashboardSummary", () => {
  /**
   * ⚠ THE assertion of this file. `dashboard_summary` and `telematics_coverage_buckets` are both
   * `security invoker` and both `coalesce(p_org, auth_org_id())` — a correct tenant filter for a
   * browser session and NO filter at all here, where the service role bypasses RLS and
   * `auth_org_id()` is null. Dropping either argument reads every carrier in the database, which is
   * the defect 0247 was written for.
   */
  it("passes p_org to BOTH security-invoker functions", async () => {
    const rec = recorder();
    await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");

    const calls = new Map(rec.rpcs().map((c) => [c.fn, c.args as Record<string, unknown>]));
    expect(calls.get("dashboard_summary")).toEqual({ p_from: "2026-09-01", p_to: "2026-09-03", p_org: ORG });
    expect(calls.get("telematics_coverage_buckets")).toEqual({ p_org: ORG });
  });

  it("scopes the two table reads it still makes to the org", async () => {
    const rec = recorder();
    await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");
    expectOrgScoped(rec, ORG);
  });

  it("returns the summary the page binds to, from the measurements and the two owners' answers", async () => {
    const rec = recorder();
    const s = await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");

    expect(s.totalSpend).toBe(400);
    expect(s.totalGallons).toBe(100.5);
    expect(s.reeferSpend).toBe(100);
    expect(s.openAnomalies).toBe(3);
    expect(s.anomaliesBySeverity).toEqual({ low: 2, medium: 0, high: 0, critical: 1 });
    expect(s.topVehiclesByRisk).toEqual([{ id: "v1", label: "1207", anomalyCount: 3, criticalCount: 1 }]);
    expect(s.topDriversByRisk).toEqual([{ id: "d1", label: "Ana Ruiz", anomalyCount: 2, criticalCount: 0 }]);
    // 2026-09-02 saw no spend and is a real $0 day between two that did.
    expect(s.spendTrend).toEqual([
      { date: "2026-09-01", value: 300 },
      { date: "2026-09-02", value: 0 },
      { date: "2026-09-03", value: 100 },
    ]);
    expect(s.coveragePct).toBe(50); // 1 of 2 fills in the window
    expect(s.allTimeCoveragePct).toBe(75); // 30 reconciled of 40 fills, all time
    expect(s.declinedCount).toBe(4);
  });

  /**
   * Q9's whole reason for going first: `movingSpend = max(0, tractorSpend − idleCostUsd)` cannot be
   * produced server-side without the idle basis. 1.5 h at 2 gal/h and $10/gal is $30, against $300
   * of tractor spend.
   */
  it("prices idle with the idle module's basis and nets it out of tractor spend", async () => {
    const rec = recorder();
    const s = await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(s.idleHours).toBe(1.5);
    expect(s.idleCostUsd).toBe(30);
    expect(s.movingSpend).toBe(270);
  });

  it("asks fuel for the declines over the EFS reject window, not the calendar window", async () => {
    const rec = recorder({ declinedCount: 9 });
    const s = await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");

    expect(s.declinedCount).toBe(9);
    const filters = rec.forTable("declined_transactions")[0]!.filters();
    // 00:00 Central on the 1st through 00:00 Central on the 4th — EFS prints rejects in one fixed
    // zone whatever the station's own zone is, so the window is computed and half-open.
    expect(filters).toContainEqual({ col: "declined_at", val: "2026-09-01T05:00:00.000Z" });
    expect(filters).toContainEqual({ col: "declined_at", val: "2026-09-04T05:00:00.000Z" });
  });

  it("answers an empty dashboard for a carrier with no rows, rather than throwing", async () => {
    const rec = createSupabaseRecorder({
      tables: { declined_transactions: { count: 0 }, idle_settings: [], fuel_prices: [] },
      rpc: { dashboard_summary: [], telematics_coverage_buckets: [] },
    });
    const s = await readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03");

    expect(s.totalSpend).toBe(0);
    expect(s.spendTrend).toEqual([]);
    // No fills either way, so neither percentage may claim a number — and never a 0.
    expect(s.coveragePct).toBeNull();
    expect(s.allTimeCoveragePct).toBeNull();
  });

  it("throws the function's own error rather than reporting an empty fleet", async () => {
    const rec = createSupabaseRecorder({
      tables: { declined_transactions: { count: 0 }, idle_settings: [], fuel_prices: [] },
      rpc: { dashboard_summary: { error: { message: "function dashboard_summary does not exist" } } },
    });
    await expect(readDashboardSummary(rec.client, ORG, "2026-09-01", "2026-09-03")).rejects.toThrow(
      "function dashboard_summary does not exist",
    );
  });
});
