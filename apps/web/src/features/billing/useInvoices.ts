import { type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { exclusiveEnd } from "@/lib/dateWindow";
import type { FinancialEntryDto } from "@silvicom/shared";

/**
 * An invoice row plus the dispatcher who booked the load (0273). The name is joined server-side
 * from the staged bill, so it is absent on bills swept before the dispatcher column existed and
 * on orders that carry no operations user — the table says "Unassigned" rather than guessing.
 */
export type LedgerEntry = FinancialEntryDto & { dispatcher_name?: string | null };

export const INVOICES_PAGE_SIZE = 50;

/** Billing data layer — earnings entries + margin per truck, API-only (D-SEP7). */
export function useInvoicesQuery(filter: Ref<{ q: string; from: string; to: string; page: number }>) {
  return useQuery({
    queryKey: ["billing", "invoices", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ entries: LedgerEntry[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams();
      if (f.q.trim()) params.set("q", f.q.trim());
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", exclusiveEnd(f.to));
      params.set("limit", String(INVOICES_PAGE_SIZE));
      params.set("offset", String((f.page - 1) * INVOICES_PAGE_SIZE));
      const r = await apiFetch<{ entries: LedgerEntry[]; total: number }>(`/api/billing/invoices?${params}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load invoices");
      return { entries: r.data.entries, total: r.data.total };
    },
  });
}

export interface TruckMargin {
  vehicleId: string | null;
  earnings: number;
  expenses: number;
  margin: number;
  entries: number;
}

export function useMarginByTruckQuery(from: Ref<string>, to: Ref<string>) {
  return useQuery({
    queryKey: ["billing", "margin", from, to] as const,
    queryFn: async (): Promise<TruckMargin[]> => {
      const r = await apiFetch<{ trucks: TruckMargin[] }>(`/api/billing/margin-by-truck?from=${from.value}&to=${exclusiveEnd(to.value)}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load margins");
      return r.data.trucks;
    },
  });
}
