import { type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { exclusiveEnd } from "@/lib/dateWindow";
import type { CpmReport } from "@silvicom/shared";

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
  bookedInvoices: number;
  /** When the McLeod financial sweep last landed — the "figures as of" the header prints; null if never. */
  financialSweptAt: string | null;
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
  /** The inclusive end day the picker shows — converted to the API's exclusive bound on send. */
  to: string;
  includeOwnerOperators: boolean;
}

export function useCpmQuery(filter: Ref<CpmFilter>) {
  return useQuery({
    queryKey: ["accounting", "cpm", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ report: CpmReport; provenance: CpmProvenance }> => {
      const f = filter.value;
      const params = new URLSearchParams({ from: f.from, to: exclusiveEnd(f.to) });
      // Sent only when true, and read as a strict "1"/"true" server-side: `z.coerce.boolean()`
      // treated the STRING "0" as true, so a hand-typed `?includeOwnerOperators=false` used to
      // switch the pool ON. The page never sent that shape; the URL is a supported entry point.
      if (f.includeOwnerOperators) params.set("includeOwnerOperators", "1");
      const r = await apiFetch<{ report: CpmReport; provenance: CpmProvenance }>(
        `/api/accounting/cpm?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not compute cost per mile");
      return { report: r.data.report, provenance: r.data.provenance };
    },
  });
}
