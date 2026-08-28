import type { TmsSettlementFact, SettlementPayeeType } from "./settlementFact.js";

/**
 * Owner-operators, told apart from company trucks — the half of the fleet whose arithmetic is a
 * different question (owner ruling 2026-08-28).
 *
 * A company truck's cost is the carrier's fuel and the driver's pay. A contractor's is a SHARE of
 * the load, and the carrier's earning is the remainder. Averaging the two produces a cost per mile
 * that describes neither, which is why they were already pooled apart — but pooling by TRUCK was
 * too blunt, and this module exists because of what that measured.
 *
 * June 2026, from the sandbox: five owner-operator payees ran eight tractors, and four of those
 * tractors were ALSO driven by a company driver in the same month. Classifying the whole unit sent
 * 100% of such a truck's revenue to the contractor pool while its company driver's pay stayed in
 * the truck's cost column — so those four trucks reported cost against no revenue and a falsely
 * negative net per mile. The split has to follow the SETTLEMENT, not the tractor.
 *
 * The classification itself is McLeod's and needs no tie-break: `drs_payee.type_of` agrees with
 * `drs_settle_hist.payee_type` on all 2,765 June settlements, C for C and O for O, no disagreement.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const OWNER_OPERATOR = "owner_operator" as SettlementPayeeType;

export interface OwnerOperatorSummary {
  payeeId: string;
  units: string[];
  settlements: number;
  revenue: number;
  pay: number;
  /** What the carrier keeps of the load, before deduction income and shared overhead. */
  grossMargin: number;
  /**
   * The contractor's share, read back from what settled (pay ÷ revenue on their own orders).
   *
   * Derived rather than configured on purpose. June 2026 measured three different deals across five
   * payees — SCORELIL at 95%, IVETJOIL and KANEBGIL at 90%, SWISSANM and ALLARONY at 88% — so a
   * single fleet-wide rate would have been fiction. Reading it back also means a renegotiated split
   * appears without anyone editing a table, and a payee whose loads carry no revenue reads as null
   * rather than as a suspiciously round number.
   */
  dealPct: number | null;
  /**
   * Settlement deductions that posted to a REVENUE account — the carrier's other earning on this
   * contractor. Equipment rental, insurance collection and installment sale, measured at ~$29,733
   * across five payees in June 2026.
   *
   * Only revenue-account deductions count. A repayment against `Fuel Advance` is a receivable being
   * settled, not income, and a credit to an expense account has already reduced that expense in the
   * ledger — counting either would invent earnings. 0274's header carries the split.
   */
  deductionIncome: number;
  /** What the carrier keeps in total: the load share it retained plus deduction income. */
  netMargin: number;
}

/** Mutable accumulator; `summariseOwnerOperators` turns it into the reported shape. */
export interface OwnerOperatorAccumulator {
  payeeId: string;
  pay: number;
  revenue: number;
  settlements: number;
  units: Set<string>;
}

export interface OwnerOperatorSplit {
  /** Every tractor an owner-operator settled on, whether or not a company driver also used it. */
  ownerOpUnits: Set<string>;
  /** Orders settled to an owner-operator — the grain the revenue split follows. */
  ownerOpOrders: Set<string>;
  /** Tractors that ran ONLY for a contractor in this window. */
  pureOwnerOpUnits: Set<string>;
  /** Tractors a company driver settled on, mixed or otherwise. */
  companyUnits: Set<string>;
}

/**
 * Which tractors belong to which side of the line.
 *
 * A MIXED truck stays in the company table carrying its company-side pay and revenue — dropping it
 * would lose that driver's cost entirely. Only a truck that ran purely for a contractor leaves,
 * because none of its economics are the carrier's to average, and it must not draw a share of
 * company overhead it never caused.
 */
export function classifyOwnerOperatorUnits(
  settlements: TmsSettlementFact[],
  includeOwnerOperators: boolean,
): OwnerOperatorSplit {
  const ownerOpUnits = new Set<string>();
  const ownerOpOrders = new Set<string>();
  const companyUnits = new Set<string>();

  for (const s of settlements) {
    const isOwnerOperator = s.payee_type === OWNER_OPERATOR;
    if (isOwnerOperator) {
      if (s.tractor_unit) ownerOpUnits.add(s.tractor_unit);
      if (s.order_external_id) ownerOpOrders.add(s.order_external_id);
    } else if (s.tractor_unit) {
      companyUnits.add(s.tractor_unit);
    }
  }

  const pureOwnerOpUnits = new Set<string>();
  if (!includeOwnerOperators) {
    for (const unit of ownerOpUnits) if (!companyUnits.has(unit)) pureOwnerOpUnits.add(unit);
  }

  return { ownerOpUnits, ownerOpOrders, pureOwnerOpUnits, companyUnits };
}

/** Start a per-payee tally from the owner-operator settlements in the window. */
export function accumulateOwnerOperatorPay(
  settlements: TmsSettlementFact[],
): Map<string, OwnerOperatorAccumulator> {
  const byPayee = new Map<string, OwnerOperatorAccumulator>();
  for (const s of settlements) {
    if (s.payee_type !== OWNER_OPERATOR) continue;
    const id = s.payee_id ?? "(unnamed)";
    const row = byPayee.get(id) ?? { payeeId: id, pay: 0, revenue: 0, settlements: 0, units: new Set<string>() };
    row.pay = round(row.pay + s.total_pay);
    row.settlements++;
    if (s.tractor_unit) row.units.add(s.tractor_unit);
    byPayee.set(id, row);
  }
  return byPayee;
}

/**
 * Credit one owner-operator bill to the payee whose order it was.
 *
 * Matched through the settlement rather than the tractor, which is the whole point: a bill on a
 * shared truck belongs to whoever settled its order.
 */
export function creditOwnerOperatorRevenue(
  byPayee: Map<string, OwnerOperatorAccumulator>,
  settlements: TmsSettlementFact[],
  orderExternalId: string | null,
  dollars: number,
): void {
  for (const s of settlements) {
    if (s.order_external_id !== orderExternalId) continue;
    if (s.payee_type !== OWNER_OPERATOR) continue;
    const row = byPayee.get(s.payee_id ?? "(unnamed)");
    if (row) row.revenue = round(row.revenue + dollars);
    return;
  }
}

/** The reported shape, richest contractor first. */
export function summariseOwnerOperators(
  byPayee: Map<string, OwnerOperatorAccumulator>,
  /**
   * Revenue-account deduction dollars per payee, classified by the CALLER against McLeod's chart of
   * accounts. Passed in rather than derived here because this module is pure and the account master
   * is I/O — and because the classification must stay McLeod's rather than a list we maintain.
   */
  deductionIncomeByPayee: Record<string, number> = {},
): OwnerOperatorSummary[] {
  return [...byPayee.values()]
    .map((r) => {
      const grossMargin = round(r.revenue - r.pay);
      const deductionIncome = round(deductionIncomeByPayee[r.payeeId] ?? 0);
      return {
        payeeId: r.payeeId,
        units: [...r.units].sort(),
        settlements: r.settlements,
        revenue: r.revenue,
        pay: r.pay,
        grossMargin,
        deductionIncome,
        netMargin: round(grossMargin + deductionIncome),
        dealPct: r.revenue > 0 ? Math.round((r.pay / r.revenue) * 10000) / 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
