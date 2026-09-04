import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { StatementSection, LedgerMonthState } from "./useIncomeStatement";
import type { MonthMileage } from "./useMileageCoverage";

/**
 * The fleet report (G1/G5) — one call for the whole finance overview.
 *
 * Every figure arrives computed. This file adds no arithmetic, and neither should the page: a rate
 * recomputed in a template is a second place for it to be wrong, and the reason these numbers can
 * be trusted is that there is exactly one.
 *
 * A `null` rate is never a zero. It means the period's mileage coverage is short of its fleet, and
 * `mileageReason` says which months and how many trucks — print that, never a dash on its own.
 */

export interface FleetTruck {
  tractor_unit: string;
  loads: number;
  miles: number | null;
  revenue: number;
  revenuePerMile: number | null;
  isOwnerOperator: boolean;
}

export interface OwnerOperatorRow {
  payeeId: string;
  units: string[];
  settlements: number;
  revenue: number;
  pay: number;
  grossMargin: number;
  deductionIncome: number;
  netMargin: number;
  /** Read back from pay ÷ revenue on their own orders. Null when their loads carry no revenue. */
  dealPct: number | null;
}

export interface FamilyRow {
  key: string;
  label: string;
  isRevenue: boolean;
  /** True for the catch-all family: an account the signed map does not name yet. */
  isUnassigned: boolean;
  amount: number;
  toDateAmount: number | null;
  pctOfRevenue: number | null;
  toDatePctOfRevenue: number | null;
  perMile: number | null;
  accounts: number;
}

export interface FamilySummaryResponse {
  revenue: FamilyRow[];
  expense: FamilyRow[];
  /** Families against the statement's totals. Non-zero means an account is filed on the wrong side. */
  tieOut: { revenue: number; expenses: number };
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

export interface FleetReportResponse {
  period: { from: string; to: string };
  total: FleetColumn;
  company: FleetColumn;
  ownerOperator: FleetColumn;
  ownerOperatorBasis: {
    trucks: string[];
    settlements: number;
    pay: number;
    loadRevenue: number;
    deductionIncome: number;
    unruledDeductions: number;
  };
  billedMiles: number;
  emptyMiles: number | null;
  emptyPct: number | null;
  revenuePerBilledMile: number | null;
  mileageReason: string | null;
  statement: {
    sections: StatementSection[];
    revenue: number;
    expenses: number;
    net: number;
    toDateRevenue: number | null;
    toDateExpenses: number | null;
    toDateNet: number | null;
    unrecognisedNet: number;
  };
  tieOut: { revenue: number; expenses: number };
  monthsCovered: string[];
  monthsMissing: string[];
  /** Months swept mid-month, excluded from every figure above with the reason beside them (G11). */
  monthsPartial: LedgerMonthState[];
  ledgerReason: string | null;
  /** The statement as ten rows of family (G6) — a signed grouping, not a derived one. */
  families: FamilySummaryResponse;
  /** When the McLeod financial sweep last landed. Null means it never has (G8). */
  sweptAt: string | null;
  /** One row per tractor — only what is precise for one truck (§2 Tab 4). */
  trucks: FleetTruck[];
  /** One row per contractor payee, with the deal read back from what settled. */
  ownerOperators: OwnerOperatorRow[];
  toDateFrom: string;
  /** Present so a caller can show coverage month by month without a second read. */
  months?: MonthMileage[];
}

export function useFleetReportQuery(filter: Ref<{ from: string; to: string }>) {
  const key = computed(() => ["accounting", "fleet-report", filter.value.from, filter.value.to] as const);
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<FleetReportResponse> => {
      const q = new URLSearchParams({ from: filter.value.from, to: filter.value.to });
      const r = await apiFetch<FleetReportResponse>(`/api/accounting/fleet-report?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the fleet report");
      return r.data;
    },
  });
}
