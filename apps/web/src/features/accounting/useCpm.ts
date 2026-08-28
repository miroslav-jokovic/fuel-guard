import { type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { CpmReport, DeadheadTreatment } from "@silvicom/shared";

/**
 * Cost-per-mile data layer — API-only like the rest of accounting (D-SEP7): the harness runs
 * server-side over deny-all tables, and the caveats it generates are part of the payload, not
 * decoration. The report's types come from shared's cpmHarness — the page renders the contract,
 * it never re-derives a number.
 */
export interface CpmProvenance {
  window: { from: string; to: string };
  movements: number;
  fuelVehicles: number;
  settlements: number;
  vouchers: number;
  samsaraVehicles: number;
  scheduledUnits: number;
  bookedInvoices: number;
  glCheck: {
    revenue: number;
    expenses: number;
    net: number;
    netCpm: number;
    monthsCovered: string[];
    monthsMissing: string[];
    unclassifiedNet: number;
  };
  pendingSources: string[];
  notes: string[];
}

export interface CpmFilter {
  from: string;
  to: string;
  deadhead: DeadheadTreatment;
  includeOwnerOperators: boolean;
}

export function useCpmQuery(filter: Ref<CpmFilter>) {
  return useQuery({
    queryKey: ["accounting", "cpm", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ report: CpmReport; provenance: CpmProvenance }> => {
      const f = filter.value;
      const params = new URLSearchParams({ from: f.from, to: f.to, deadhead: f.deadhead });
      if (f.includeOwnerOperators) params.set("includeOwnerOperators", "1");
      const r = await apiFetch<{ report: CpmReport; provenance: CpmProvenance }>(
        `/api/accounting/cpm?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not compute cost per mile");
      return { report: r.data.report, provenance: r.data.provenance };
    },
  });
}
