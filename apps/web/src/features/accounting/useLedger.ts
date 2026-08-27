import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

import type { FinancialEntryDto } from "@silvicom/shared";

/**
 * Accounting data layer — API-only by design (D-SEP7): financial_entries is deny-all in RLS,
 * so /api/accounting is THE read path, role-gated on the accounting section's matrix row.
 * No PostgREST fallback exists or ever should.
 */
export type LedgerEntry = FinancialEntryDto;

export interface LedgerFilter {
  q: string;
  category: string;
  direction: string;
  from: string;
  to: string;
  all: boolean;
  page: number;
}

export const LEDGER_PAGE_SIZE = 50;

export function useLedgerQuery(filter: Ref<LedgerFilter>) {
  return useQuery({
    queryKey: ["accounting", "ledger", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ entries: LedgerEntry[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams();
      if (f.q.trim()) params.set("q", f.q.trim());
      if (f.category) params.set("category", f.category);
      if (f.direction) params.set("direction", f.direction);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.all) params.set("all", "1");
      params.set("limit", String(LEDGER_PAGE_SIZE));
      params.set("offset", String((f.page - 1) * LEDGER_PAGE_SIZE));
      const r = await apiFetch<{ entries: LedgerEntry[]; total: number }>(`/api/accounting/entries?${params}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the ledger");
      return { entries: r.data.entries, total: r.data.total };
    },
  });
}

export interface CategorySummary {
  category: string;
  direction: string;
  entries: number;
  amount: number;
}

export function useLedgerSummaryQuery(from: Ref<string>, to: Ref<string>) {
  return useQuery({
    queryKey: ["accounting", "summary", from, to] as const,
    enabled: computed(() => !!from.value && !!to.value),
    queryFn: async (): Promise<CategorySummary[]> => {
      const r = await apiFetch<{ summary: CategorySummary[] }>(
        `/api/accounting/summary?from=${from.value}&to=${to.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the summary");
      return r.data.summary;
    },
  });
}
