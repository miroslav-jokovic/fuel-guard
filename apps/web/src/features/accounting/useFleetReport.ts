import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { StatementSection } from "./useIncomeStatement";
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
