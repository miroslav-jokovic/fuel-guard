import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { PartUsageDetailDto, PartUsageListDto, PartUsageShow, PartUsageSort } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { INVENTORY_PAGE_SIZE } from "./useInventory";

/**
 * Shop parts by use, client side (SHOP-PARTS-USAGE-PLAN.md SP-U2). Keys start `["inventory", …]` like
 * every inventory read (see `useInventory.ts`), so one invalidation reaches them too.
 *
 * Its own file because `useInventory.ts` sits at the 500-line budget.
 */

export interface PartUsageFilter {
  search?: string;
  show: PartUsageShow;
  sort: PartUsageSort;
  descending: boolean;
  page: number;
}

export function usePartUsageListQuery(filter: Ref<PartUsageFilter>) {
  return useQuery({
    queryKey: ["inventory", "part-usage", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PartUsageListDto> => {
      const f = filter.value;
      const params = new URLSearchParams({
        show: f.show,
        sort: f.sort,
        dir: f.descending ? "desc" : "asc",
        limit: String(INVENTORY_PAGE_SIZE),
        offset: String((f.page - 1) * INVENTORY_PAGE_SIZE),
      });
      if (f.search) params.set("search", f.search);
      const r = await apiFetch<PartUsageListDto>(`/api/maintenance/inventory/part-usage?${params}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load parts");
      return r.data;
    },
  });
}

export function usePartUsageDetailQuery(id: Ref<string>, page: Ref<number>) {
  return useQuery({
    queryKey: ["inventory", "part-usage-detail", id, page] as const,
    enabled: computed(() => Boolean(id.value)),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PartUsageDetailDto> => {
      const r = await apiFetch<PartUsageDetailDto>(
        `/api/maintenance/inventory/parts/${encodeURIComponent(id.value)}/usage?page=${page.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load where this part went");
      return r.data;
    },
  });
}
