import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * The monthly close (D-FIN14): one row per McLeod company and month, with every bucket the ledger
 * anchor sorts expenses into, every tie-out residual, and the verdict. `open_reasons` is the
 * page's whole explanation of an open month — the API names each reason; the page prints it.
 */
export interface MonthClose {
  company_id: string;
  period_start: string;
  period_end: string;
  swept_at: string | null;
  computed_at: string;
  gl_revenue: number | string;
  gl_expenses: number | string;
  anchored: boolean;
  attributed_direct: number | string;
  fixed_charged: number | string;
  allocated_overhead: number | string;
  unallocated_overhead: number | string;
  owner_operator_pool: number | string;
  cpm_residual: number | string | null;
  settlement_drift: number | string | null;
  billing_drift: number | string | null;
  fuel_residual: number | string | null;
  status: "open" | "hardened";
  open_reasons: string[];
}

export function useMonthClosesQuery() {
  return useQuery({
    queryKey: ["accounting", "month-closes"] as const,
    queryFn: async (): Promise<MonthClose[]> => {
      const r = await apiFetch<{ closes: MonthClose[] }>("/api/accounting/month-closes");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the monthly closes");
      return r.data.closes;
    },
  });
}
