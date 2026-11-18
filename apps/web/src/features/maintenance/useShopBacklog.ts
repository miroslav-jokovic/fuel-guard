import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { AnnualDisagreementDto, AnnualDueDto, ShopDefectDto, ShopSummary, ShopWorkOrderDto } from "@silvicom/shared";

/**
 * What is waiting on the shop (FLEET-MANAGER-HOME-PLAN FM3, Q-FM6 (a)): the four counts the Operations
 * tab's Shop card shows, and the two FleetPal lists two of them open. Each count is the length of its
 * list on the server (`shopBacklog.ts`), so the card and the page cannot disagree.
 *
 * None takes a page: the lists answer whole, for the reason `useLowStockQuery` gives.
 */
async function read<T>(path: string, what: string): Promise<T> {
  const r = await apiFetch<{ data: T }>(path);
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? `Could not load ${what}`);
  return r.data.data;
}

export function useShopSummaryQuery() {
  return useQuery({
    queryKey: ["maintenance", "shop-summary"] as const,
    queryFn: () => read<ShopSummary>("/api/maintenance/shop-summary", "the shop summary"),
  });
}

export function useOpenWorkOrdersQuery() {
  return useQuery({
    queryKey: ["maintenance", "work-orders"] as const,
    queryFn: () => read<ShopWorkOrderDto[]>("/api/maintenance/work-orders", "open work orders"),
  });
}

export function useUnresolvedDefectsQuery() {
  return useQuery({
    queryKey: ["maintenance", "defects"] as const,
    queryFn: () => read<ShopDefectDto[]>("/api/maintenance/defects", "unresolved defects"),
  });
}

/** Units whose annual FleetPal and our record disagree on (DISPATCH-BOARD-V2-PLAN Q-DBV2), most pressing first. */
export function useAnnualDisagreementsQuery() {
  return useQuery({
    queryKey: ["maintenance", "annual-disagreements"] as const,
    queryFn: () => read<AnnualDisagreementDto[]>("/api/maintenance/annual-disagreements", "the annual dates to check"),
  });
}

/** The worklist's annual group (D-MX2, Q-MX5 (a)): due within 30 days or overdue, by our record. */
export function useAnnualDueQuery() {
  return useQuery({
    queryKey: ["maintenance", "annual-due"],
    queryFn: () => read<AnnualDueDto[]>("/api/maintenance/annual-due", "the annual inspections due"),
  });
}
