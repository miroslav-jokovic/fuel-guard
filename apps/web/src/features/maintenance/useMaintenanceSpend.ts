import { type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { FinancialEntryDto as LedgerEntry } from "@silvicom/shared";

/**
 * Maintenance data layer — reads category='maintenance' from the financial store, which is
 * EMPTY until finance's GL ruling and/or FleetPal land (the API says so via `pendingSources`,
 * and the page renders that truth instead of a mysterious zero).
 */
export interface MaintenanceSpend {
  entries: LedgerEntry[];
  /** Ledger LINES in the window. */
  total: number;
  /**
   * Dollars over the WHOLE window, from the endpoint — never summed from `entries`, which is one
   * page of fifty. A card adding the page up would be right for fifty repairs and wrong for the
   * fifty-first, and would be believed.
   */
  totalAmount: number;
  pendingSources: string | null;
}

export function useMaintenanceSpendQuery(filter: Ref<{ from: string; to: string; page: number }>) {
  return useQuery({
    queryKey: ["maintenance", "spend", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MaintenanceSpend> => {
      const f = filter.value;
      const params = new URLSearchParams({ from: f.from, to: f.to, limit: "50", offset: String((f.page - 1) * 50) });
      const r = await apiFetch<MaintenanceSpend>(
        `/api/maintenance/spend?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load maintenance spend");
      return r.data;
    },
  });
}
