import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFleetReport,
  buildFamilySummary,
  type FleetReport,
  type FleetDeduction,
  type LedgerMonth,
  type FamilySummary,
} from "@silvicom/shared";
import {
  readSettlementsWindow,
  readBillingWindow,
  readOwnerOperatorDeductions,
  readFinancialSyncedAt,
} from "../mcleod/index.js";
import { readVehicleMonthlyMiles } from "../samsara/index.js";
import { readLedgerForPeriod, monthStart, nextMonthStart, monthsBetween } from "./ledgerPeriod.js";
import { getMileageCoverage } from "./mileageCoverage.js";

/**
 * The fleet report (G1) — one call that serves every tab of the finance section.
 *
 * I/O only. Every figure is computed by `computeFleetReport` in `@silvicom/shared`, where the rules
 * are tested and mutation-tested; this file fetches, re-keys and hands over. Six reads, all through
 * the owning collectors' interfaces (D-SEP1), issued together because they do not depend on each
 * other and a report that waits six round trips in series feels broken for no reason.
 *
 * **What each read is for, and the trap in it:**
 *
 *  · **Ledger** — the whole money answer. Widened to calendar months by `ledgerPeriod`, shared with
 *    the income statement so both agree on which months a figure covers.
 *  · **Mileage coverage** — the denominator, or the reason there is not one. Short coverage does
 *    not degrade the report; it removes every rate and keeps all the money (G10).
 *  · **Settlements** — who is a contractor. `payee_type` is the only place that is recorded.
 *  · **Bills** — what contractors' loads earned. Matched by ORDER, not by truck: four of this
 *    carrier's eight contractor tractors also ran for a company driver, and matching by truck hands
 *    that driver's revenue to the contractor column along with the tractor.
 *  · **Deductions** — what contractors earned the carrier, classified by the ACCOUNT each posts to.
 *    The reader returns a `glid`; the account class comes from the chart of accounts already loaded
 *    for the ledger, so no second read and no code table.
 *  · **Per-vehicle miles** — re-keyed to tractor unit, because Samsara attributes by vehicle and
 *    every McLeod subledger attributes by unit number. Without it contractors show a dash for every
 *    rate rather than a split the data cannot make.
 *
 * Excise tax is excluded from bill revenue for the reason it is excluded everywhere else: money
 * collected for the government was never the carrier's earning.
 */

export interface FleetReportResult extends FleetReport {
  monthsCovered: string[];
  monthsMissing: string[];
  /** Months a sweep reached while they were still running, excluded from every figure (G11). */
  monthsPartial: LedgerMonth[];
  ledgerReason: string | null;
  toDateFrom: string;
  /**
   * When the McLeod financial sweep last landed, or null if it never has (G8).
   *
   * It rides here because the page's provenance line has to state it beside the figures it
   * qualifies: every number on this report is as of that moment, and one that is four days old
   * during a month-end close is a different answer from one taken this morning. Null is printed,
   * never hidden — "never swept" is the most important thing a finance page can say.
   */
  sweptAt: string | null;
  /**
   * The ninety-four-row statement as ten rows of family (G6).
   *
   * It rides on this call rather than on `/income-statement` because it needs BOTH sides of the
   * question: the statement's own lines, and the period's measured miles. Only this service holds
   * the second, and computing "fuel is 64 cents a mile" without a denominator it trusts is exactly
   * the invented figure this section refuses.
   */
  families: FamilySummary;
}

/** Re-key Samsara's per-vehicle miles by tractor unit — the key every McLeod subledger uses. */
async function milesByUnit(
  admin: SupabaseClient,
  orgId: string,
  byVehicle: Map<string, number>,
): Promise<Record<string, number> | undefined> {
  if (!byVehicle.size) return undefined;
  const { data, error } = await admin
    .from("vehicles")
    .select("id, unit_number")
    .eq("org_id", orgId)
    .in("id", [...byVehicle.keys()]);
  if (error) throw new Error(`vehicles read failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const v of (data ?? []) as Array<{ id: string; unit_number: string | null }>) {
    const unit = v.unit_number?.trim();
    if (!unit) continue;
    out[unit] = Math.round(((out[unit] ?? 0) + (byVehicle.get(v.id) ?? 0)) * 10) / 10;
  }
  return out;
}

/** The calendar months the window touches, as the Samsara reader wants them. */
function coveredMonths(fromIso: string, toIso: string): Array<{ year: number; month: number }> {
  return monthsBetween(monthStart(fromIso), nextMonthStart(toIso)).map((m) => ({
    year: Number(m.slice(0, 4)),
    month: Number(m.slice(5, 7)),
  }));
}

export async function getFleetReport(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<FleetReportResult> {
  // Subledger windows use the requested dates; the ledger widens to whole months on its own. That
  // asymmetry is deliberate and it is what the report states: the money is the month's, the
  // contractor split is the window's, and a caller asking for a whole month gets both aligned.
  const [ledger, coverage, settlements, bills, deductions, samsaraMiles, sweptAt] = await Promise.all([
    readLedgerForPeriod(admin, orgId, fromIso, toIso),
    getMileageCoverage(admin, orgId, fromIso, toIso),
    readSettlementsWindow(admin, orgId, fromIso, toIso),
    readBillingWindow(admin, orgId, fromIso, toIso),
    readOwnerOperatorDeductions(admin, orgId, fromIso, toIso),
    readVehicleMonthlyMiles(admin, orgId, coveredMonths(fromIso, toIso)),
    readFinancialSyncedAt(admin, orgId),
  ]);

  const typeByGlid = new Map(ledger.accounts.map((a) => [a.glid.trim(), a.type_id?.trim() ?? null]));

  // The reader already filters to contractors and excludes voids, so `payee_type` is a constant
  // here rather than a column — stated rather than assumed, so a future reader widening that filter
  // sees what depends on it.
  const fleetDeductions: FleetDeduction[] = deductions.map((d) => ({
    payee_type: "owner_operator",
    account_type: d.glid ? (typeByGlid.get(d.glid.trim()) ?? null) : null,
    amount: Number(d.amount),
  }));

  const report = computeFleetReport({
    period: { from: fromIso, to: toIso },
    ledger: { period: ledger.period, toDate: ledger.toDate, accounts: ledger.accounts },
    mileage: {
      months: coverage.months,
      miles: coverage.miles,
      trucks: coverage.trucks,
      reason: coverage.reason,
    },
    settlements: settlements
      // A voided settlement's pay was never paid; counting it would inflate the contractor column
      // and, through the remainder construction, deflate the company one.
      .filter((s) => !s.is_void)
      .map((s) => ({
        payee_type: s.payee_type,
        tractor_unit: s.tractor_unit,
        order_external_id: s.order_external_id,
        total_pay: Number(s.total_pay),
      })),
    bills: bills
      // The same predicate every other revenue figure uses (D-MC12): a bill counts when the GL
      // booked it. Reading the staged rows instead would quietly disagree with the statement above.
      .filter((b) => b.post_key && b.post_module === "BILL")
      .map((b) => ({
        order_external_id: b.order_external_id,
        tractor_unit: b.tractor_unit,
        revenue: Number(b.total_charges) + Number(b.other_charge ?? 0),
      })),
    deductions: fleetDeductions,
    billedMiles: coverage.billedMiles,
    milesByUnit: await milesByUnit(admin, orgId, samsaraMiles),
  });

  return {
    ...report,
    families: buildFamilySummary(report.statement, coverage.miles),
    monthsCovered: ledger.monthsCovered,
    monthsMissing: ledger.monthsMissing,
    monthsPartial: ledger.monthsPartial,
    ledgerReason: ledger.ledgerReason,
    toDateFrom: ledger.toDateFrom,
    sweptAt,
  };
}
