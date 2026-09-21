/**
 * The fleet Dashboard, assembled server-side (queue item 5 step 3,
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2c).
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────────────────────────
 * `useDashboard.ts` draws this screen from TEN reads across six modules — two of them paged 1,000
 * rows at a time, plus a chunked `N × 100` `.in()` loop to attach a driver to each flagged fill.
 * D-PREC8 named that as the architectural root of the audit's date defects: a component that builds
 * its own window cannot see the org's operating timezone, the station's business date, or how fresh
 * the tables it is dividing are. All three are columns, so the reduction moved to where they are
 * (migration 0347, `dashboard_summary`).
 *
 * What is left here is FOUR calls, and each one is a boundary rather than a shortcut:
 *  1. `dashboard_summary(p_from, p_to, p_org)` — the measurements, one round trip.
 *  2. `countDeclinedAttempts` through `fuel`'s index — `declined_transactions` is raw-layer and
 *     sealed to its collector, so §7.2b ruled the count stays with the owner. This is the reason
 *     the honest figure is "ten reads become two" rather than one.
 *  3. `resolveIdleCostBasis` through `idle`'s index (Q9) — the SAME basis the Idling page and the
 *     fuel-spend report price idled gallons with.
 *  4. `telematics_coverage_buckets(p_org)` — the all-time coverage histogram (D-SAM7, 0322).
 *
 * The verdict is `summariseDashboard`, in `@silvicom/shared`: rounding, zero-filling,
 * null-for-unknown and the moving-spend floor are product judgements and do not belong in SQL. SQL
 * measures, TypeScript concludes.
 *
 * ── ⚠ BOTH FUNCTIONS ARE `security invoker`, AND THIS READS WITH THE SERVICE ROLE ──────────────
 * D-FC1 (0247): they `coalesce(p_org, auth_org_id())`, which is a correct tenant filter for a
 * browser session and NO filter at all for `apps/api`, whose service role bypasses RLS and whose
 * `auth_org_id()` is null. Omitting `p_org` here would read every carrier in the database — the
 * exact defect 0247 was written for, where a server-rendered PDF did just that. Both calls pass it
 * explicitly, and `dashboardSummary.test.ts` asserts the argument rather than trusting the comment.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allTimeCoveragePct,
  summariseDashboard,
  type CalendarDay,
  type DashboardMeasurements,
  type DashboardSummary,
  type RiskRow,
  type TelematicsCoverageBucket,
} from "@silvicom/shared";
import { countDeclinedAttempts } from "../fuel/index.js";
import { resolveIdleCostBasis } from "../idle/index.js";

/** The row `dashboard_summary` returns. Numerics arrive from PostgREST as strings. */
interface SummaryRow {
  total_spend: number | string | null;
  total_gallons: number | string | null;
  reefer_spend: number | string | null;
  covered_txns: number | null;
  total_txns: number | null;
  spend_by_day: { date: string; value: number | string | null }[] | null;
  severity_counts: Record<string, number> | null;
  top_vehicles: RiskRowRow[] | null;
  top_drivers: RiskRowRow[] | null;
  open_anomalies: number | null;
  idle_sec: number | string | null;
}

/** `to_jsonb(v)` of the function's own CTE, so the keys are its column names. */
interface RiskRowRow {
  id: string;
  label: string;
  anomaly_count: number;
  critical_count: number;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

export async function readDashboardSummary(
  admin: SupabaseClient,
  orgId: string,
  from: CalendarDay,
  to: CalendarDay,
): Promise<DashboardSummary> {
  const [row, declinedCount, costBasis, allTimeCoveragePct] = await Promise.all([
    readMeasurements(admin, orgId, from, to),
    countDeclinedAttempts(admin, orgId, from, to),
    resolveIdleCostBasis(admin, orgId),
    readAllTimeCoverage(admin, orgId),
  ]);
  return summariseDashboard(row, { declinedCount, costBasis, allTimeCoveragePct });
}

async function readMeasurements(
  admin: SupabaseClient,
  orgId: string,
  from: CalendarDay,
  to: CalendarDay,
): Promise<DashboardMeasurements> {
  const { data, error } = await admin.rpc("dashboard_summary", { p_from: from, p_to: to, p_org: orgId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as SummaryRow | null;
  return {
    totalSpend: num(row?.total_spend),
    totalGallons: num(row?.total_gallons),
    reeferSpend: num(row?.reefer_spend),
    coveredTxns: num(row?.covered_txns),
    totalTxns: num(row?.total_txns),
    spendByDay: (row?.spend_by_day ?? []).map((d) => ({ date: String(d.date), value: num(d.value) })),
    severityCounts: row?.severity_counts ?? {},
    openAnomalies: num(row?.open_anomalies),
    topVehiclesByRisk: riskRows(row?.top_vehicles),
    topDriversByRisk: riskRows(row?.top_drivers),
    idleSec: num(row?.idle_sec),
  };
}

const riskRows = (rows: RiskRowRow[] | null | undefined): RiskRow[] =>
  (rows ?? []).map((r) => ({
    id: String(r.id),
    label: String(r.label),
    anomalyCount: num(r.anomaly_count),
    criticalCount: num(r.critical_count),
  }));

/**
 * The all-time coverage share, or null when there is no evidence for one.
 *
 * The rule — null rather than the 0 an empty denominator produces, and counts NUMBERed because
 * PostgREST returns a bigint as text — is `allTimeCoveragePct` in `@silvicom/shared`, where the
 * browser's copy of it moved when this endpoint took over the fold (step 4). It is not thrown on:
 * this is one figure on one tile and the rest of the Dashboard is fine without it, which is also
 * why a failed RPC and an empty history give the same answer.
 */
async function readAllTimeCoverage(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data } = await admin.rpc("telematics_coverage_buckets", { p_org: orgId });
  return allTimeCoveragePct(data as TelematicsCoverageBucket[] | null);
}
