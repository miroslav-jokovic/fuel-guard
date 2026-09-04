import { buildIncomeStatement, type IncomeStatementInputs, type IncomeStatement } from "./incomeStatement.js";
import type { MonthMileage } from "./mileageCoverage.js";

/**
 * The fleet report (G1) — what the company earned, what it spent, what it kept, and each of those
 * per mile, with contractors kept apart from the company's own trucks.
 *
 * This is the harness the whole finance section computes from
 * (FINANCE-FLEET-REPORT-PLAN §2.5). Three properties are contractual, not incidental:
 *
 *  1. **Every published figure is a pure function of collected rows.** No constant in this file is
 *     a dollar amount, a truck count, a month or a rate. The plan's measured tables are acceptance
 *     fixtures for the tests, and they appear nowhere in the code.
 *  2. **The period is a parameter.** Nothing here computes a month boundary. What periods the
 *     product can OFFER is decided by the collectors' grain, never by this file.
 *  3. **The tie-out is a precondition.** Company plus contractors equals the ledger by
 *     construction, and the report says how the contractor side was derived so the construction is
 *     inspectable rather than merely asserted.
 *
 * **Why the split is built the way it is.** The ledger is the only complete statement of the money,
 * and it does not separate contractors from company trucks. The subledgers do: a settlement carries
 * `payee_type`, a bill carries the order the settlement paid, and a deduction carries the GL account
 * it posts to, which is what says whether it was income to the carrier, a receivable being repaid,
 * or a cost charged back. So the contractor side is DERIVED from those, the total comes from the
 * ledger, and the company side is the remainder. That ordering matters: deriving both sides
 * independently would leave a residual with nowhere honest to go, and a residual quietly absorbed
 * is the failure this section exists to prevent. The remainder construction puts any derivation
 * error in one named place — the company column — with the contractor side's own inputs printed
 * beside it so a reader can check the derivation that produced it.
 *
 * **Per-mile figures may be `null`, and that is the point** (D-FIN10, G10). A denominator missing
 * part of the fleet produces a rate that is low on miles and high on cost, and it looks entirely
 * plausible. When coverage is short, every rate is `null` and the reason travels with the report.
 */

/** A settlement, reduced to what the split needs. */
export interface FleetSettlement {
  payee_type: string;
  tractor_unit: string | null;
  order_external_id: string | null;
  total_pay: number;
}

/** A bill, reduced to what the split needs. */
export interface FleetBill {
  order_external_id: string | null;
  tractor_unit: string | null;
  /** Linehaul plus accessorial, excise tax already excluded by the caller. */
  revenue: number;
}

/**
 * A settlement deduction with the class of the account it posts to.
 *
 * The class is the whole content of this row. "Deduction" covers four unrelated events and only the
 * account tells them apart: revenue is the carrier earning something from the contractor
 * (equipment rental, insurance collection, installment sale); an asset is a fuel advance being
 * repaid, which is a receivable settling and NOT income; a liability is a pass-through; an expense
 * is a cost charged back, which the ledger has already netted. Ruling the derivation once beats
 * ruling a hundred and fifteen codes forever, and the next code the bookkeeper invents classifies
 * itself.
 */
export interface FleetDeduction {
  payee_type: string;
  /** McLeod's `gl_account.type_id` for the account this deduction posted to. */
  account_type: string | null;
  amount: number;
}

export interface FleetReportInputs {
  /** The period, as the caller defined it. Carried through to the output, never computed here. */
  period: { from: string; to: string };
  ledger: IncomeStatementInputs;
  /** Per-month coverage from `assessMileageCoverage`, and the denominator it allows. */
  mileage: {
    months: MonthMileage[];
    /** Measured miles for the period, or null when coverage is short. */
    miles: number | null;
    trucks: number | null;
    reason: string | null;
  };
  settlements: FleetSettlement[];
  bills: FleetBill[];
  deductions: FleetDeduction[];
  /** Billed miles over the period, from bills re-dated to delivery — the second denominator (G9). */
  billedMiles: number;
  /**
   * Measured miles per truck unit over the period, when the caller has them.
   *
   * Optional because the contractor column is readable without it — what they earned and what they
   * were paid is the question a boss asks about contractors — and because supplying it is a second
   * read the monthly page does not always need. Absent, contractors show a dash for every rate
   * rather than an invented one, and the company column keeps the whole measured denominator.
   */
  milesByUnit?: Record<string, number>;
}

export interface FleetColumn {
  trucks: number | null;
  miles: number | null;
  revenue: number;
  expenses: number;
  net: number;
  revenuePerMile: number | null;
  costPerMile: number | null;
  netPerMile: number | null;
}

export interface FleetReport {
  period: { from: string; to: string };
  total: FleetColumn;
  company: FleetColumn;
  ownerOperator: FleetColumn;
  /** How the contractor column was derived, for a reader to check rather than trust. */
  ownerOperatorBasis: {
    trucks: string[];
    settlements: number;
    pay: number;
    loadRevenue: number;
    deductionIncome: number;
    /** Deductions that posted to no account, so their class is unknown. Excluded, and stated. */
    unruledDeductions: number;
  };
  /** Miles the loads were priced on, and what is left over (G9). */
  billedMiles: number;
  emptyMiles: number | null;
  emptyPct: number | null;
  revenuePerBilledMile: number | null;
  /** Null when a rate could not be computed, with the reason a page prints beside the dash. */
  mileageReason: string | null;
  statement: IncomeStatement;
  /**
   * Company + contractors against the ledger. Zero by construction — the harness refuses to build a
   * report where it is not, so this is here to be asserted rather than to be read.
   */
  tieOut: { revenue: number; expenses: number };
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;
/**
 * Dollars per mile to the cent. Null when there is no denominator (D-FIN10).
 *
 * Exported because the trend (G9) computes the same figure over single months and a second copy of
 * this two-line rule is a second place for "what happens when the denominator is missing" to be
 * answered differently — which is the one question this section cannot afford two answers to.
 */
export const perMileRate = (dollars: number, miles: number | null): number | null =>
  miles == null || miles <= 0 ? null : Math.round((dollars / miles) * 100) / 100;

const OWNER_OPERATOR = "owner_operator";

function column(trucks: number | null, miles: number | null, revenue: number, expenses: number): FleetColumn {
  const net = round(revenue - expenses);
  return {
    trucks,
    miles,
    revenue: round(revenue),
    expenses: round(expenses),
    net,
    revenuePerMile: perMileRate(revenue, miles),
    costPerMile: perMileRate(expenses, miles),
    netPerMile: perMileRate(net, miles),
  };
}

export function computeFleetReport(inputs: FleetReportInputs): FleetReport {
  const statement = buildIncomeStatement(inputs.ledger);

  // ── The contractor side, derived from the subledgers ────────────────────────────────────────
  const ownerOpUnits = new Set<string>();
  const ownerOpOrders = new Set<string>();
  let ownerOpPay = 0;
  let ownerOpSettlements = 0;
  for (const s of inputs.settlements) {
    if (s.payee_type !== OWNER_OPERATOR) continue;
    ownerOpSettlements++;
    ownerOpPay = round(ownerOpPay + s.total_pay);
    if (s.tractor_unit) ownerOpUnits.add(s.tractor_unit);
    if (s.order_external_id) ownerOpOrders.add(s.order_external_id);
  }

  // Revenue follows the ORDER, not the truck. Four of this carrier's contractor tractors also ran
  // for a company driver in a measured month, so attributing by unit would move a company driver's
  // earnings into the contractor column along with the truck.
  let ownerOpLoadRevenue = 0;
  for (const b of inputs.bills) {
    if (b.order_external_id && ownerOpOrders.has(b.order_external_id)) {
      ownerOpLoadRevenue = round(ownerOpLoadRevenue + b.revenue);
    }
  }

  // Deduction income: only the ones that posted to a REVENUE account are the carrier earning
  // something. A fuel advance repaid posts to an asset and is a receivable settling, not income —
  // counting it would overstate what contractors earn the carrier by roughly a quarter.
  let deductionIncome = 0;
  let unruledDeductions = 0;
  for (const d of inputs.deductions) {
    if (d.payee_type !== OWNER_OPERATOR) continue;
    const type = d.account_type?.trim();
    if (!type) {
      unruledDeductions = round(unruledDeductions + d.amount);
      continue;
    }
    if (type === "Revenue" || type === "Other Revenue and Gains") {
      deductionIncome = round(deductionIncome + d.amount);
    }
  }

  const ownerOpRevenue = round(ownerOpLoadRevenue + deductionIncome);

  // ── Miles ───────────────────────────────────────────────────────────────────────────────────
  // Contractor miles come from the same measured months as everyone else's, restricted to their
  // units. When coverage is short there is no denominator for anyone, contractors included.
  const measuredMiles = inputs.mileage.miles;
  const ownerOpTruckList = [...ownerOpUnits].sort();

  // The contractor share cannot come from `MonthMileage`, which is fleet-grained by design. With
  // per-unit miles the split is exact; without them contractors get no rate rather than an invented
  // one, and the company column keeps the whole measured denominator rather than pretending to a
  // split it cannot make.
  //
  // Coverage gates this too: when the period is short of trucks there is no denominator for anyone,
  // and a per-unit total would silently supply one.
  const byUnit = inputs.milesByUnit;
  const ownerOpMiles =
    measuredMiles == null || byUnit === undefined
      ? null
      : round(ownerOpTruckList.reduce((n, u) => n + (byUnit[u] ?? 0), 0));
  const companyMiles =
    measuredMiles == null ? null : ownerOpMiles == null ? measuredMiles : round(measuredMiles - ownerOpMiles);
  const companyTrucks =
    inputs.mileage.trucks == null ? null : Math.max(0, inputs.mileage.trucks - ownerOpUnits.size);

  // ── The columns. Total is the ledger; contractors are derived; company is the remainder. ─────
  const total = column(inputs.mileage.trucks, measuredMiles, statement.revenue, statement.expenses);
  const ownerOperator = column(ownerOpUnits.size, ownerOpMiles, ownerOpRevenue, ownerOpPay);
  const company = column(
    companyTrucks,
    companyMiles,
    round(statement.revenue - ownerOpRevenue),
    round(statement.expenses - ownerOpPay),
  );

  const emptyMiles = measuredMiles == null ? null : round(measuredMiles - inputs.billedMiles);
  return {
    period: inputs.period,
    total,
    company,
    ownerOperator,
    ownerOperatorBasis: {
      trucks: ownerOpTruckList,
      settlements: ownerOpSettlements,
      pay: ownerOpPay,
      loadRevenue: ownerOpLoadRevenue,
      deductionIncome,
      unruledDeductions,
    },
    billedMiles: round(inputs.billedMiles),
    emptyMiles,
    emptyPct:
      emptyMiles == null || measuredMiles == null || measuredMiles <= 0
        ? null
        : Math.round((emptyMiles / measuredMiles) * 1000) / 10,
    revenuePerBilledMile: perMileRate(statement.revenue, inputs.billedMiles),
    mileageReason: inputs.mileage.reason,
    statement,
    tieOut: {
      revenue: round(statement.revenue - company.revenue - ownerOperator.revenue),
      expenses: round(statement.expenses - company.expenses - ownerOperator.expenses),
    },
  };
}
