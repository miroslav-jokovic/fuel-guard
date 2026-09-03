import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * The income statement (G3) — the ledger in the shape the owner's own printed McLeod P&L takes.
 *
 * Every figure is computed by `buildIncomeStatement` in `@silvicom/shared` and arrives ready to
 * print. This file adds no arithmetic on purpose: a page that recomputes a total is a second place
 * for the total to be wrong, and the reason this statement can be trusted is that there is one.
 */

export interface StatementModule {
  post_module: string;
  amount: number;
  lines: number;
}

export interface StatementLine {
  glid: string;
  /** McLeod truncates this to 28 characters AT SOURCE, so it is not unique — always show `glid`. */
  descr: string | null;
  amount: number;
  pctOfRevenue: number | null;
  toDateAmount: number | null;
  toDatePctOfRevenue: number | null;
  modules: StatementModule[];
}

export interface StatementSection {
  typeId: string | null;
  label: string;
  isRevenue: boolean;
  /** A class this build does not recognise: its dollars are shown and counted into neither total. */
  isUnrecognised: boolean;
  lines: StatementLine[];
  total: number;
  toDateTotal: number | null;
}

export interface IncomeStatementResponse {
  sections: StatementSection[];
  revenue: number;
  expenses: number;
  net: number;
  toDateRevenue: number | null;
  toDateExpenses: number | null;
  toDateNet: number | null;
  unrecognisedNet: number;
  monthsCovered: string[];
  monthsMissing: string[];
  toDateFrom: string;
}

export interface IncomeStatementFilter {
  from: string;
  to: string;
}

export function useIncomeStatementQuery(filter: Ref<IncomeStatementFilter>) {
  const key = computed(() => ["accounting", "income-statement", filter.value.from, filter.value.to] as const);
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<IncomeStatementResponse> => {
      const q = new URLSearchParams({ from: filter.value.from, to: filter.value.to });
      const r = await apiFetch<IncomeStatementResponse>(`/api/accounting/income-statement?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the income statement");
      return r.data;
    },
  });
}
