import { type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { FinancialEntryDto as LedgerEntry } from "@silvicom/shared";

/**
 * Maintenance data layer — reads category='maintenance' from the financial store, which is
 * EMPTY until finance's GL ruling and/or FleetPal land (the API says so via `pendingSources`,
 * and the page renders that truth instead of a mysterious zero).
 */
export function useMaintenanceSpendQuery(filter: Ref<{ from: string; to: string; page: number }>) {
  return useQuery({
    queryKey: ["maintenance", "spend", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ entries: LedgerEntry[]; total: number; pendingSources: string | null }> => {
      const f = filter.value;
      const params = new URLSearchParams({ from: f.from, to: f.to, limit: "50", offset: String((f.page - 1) * 50) });
      const r = await apiFetch<{ entries: LedgerEntry[]; total: number; pendingSources: string | null }>(
        `/api/maintenance/spend?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load maintenance spend");
      return r.data;
    },
  });
}
