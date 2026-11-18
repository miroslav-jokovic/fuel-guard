import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { WorkOrderDetailDto, WorkOrderFilesDto } from "@silvicom/shared";

/**
 * One FleetPal work order for `WorkOrderDrawer` — the record (F14) and its vendor files (F16, D-FP28).
 * Promoted out of `features/maintenance` with the drawer on 2026-11-18, because the roadside inspection
 * page opens the same drawer and `lint:boundaries` forbids one feature importing another's internals;
 * a copy would be a second drawer.
 */
async function read<T>(path: string, what: string): Promise<T> {
  const r = await apiFetch<{ data: T }>(path);
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? `Could not load ${what}`);
  return r.data.data;
}

/**
 * Which work order: OUR row's id (every Shop list) or FleetPal's (a roadside repair's candidate, which is
 * a snapshot and holds no row id). Null keeps the query off while the drawer is closed.
 */
export type WorkOrderTarget = { rowId: string } | { fleetpalId: string };

export function useWorkOrderDetailQuery(target: Ref<WorkOrderTarget | null>) {
  return useQuery({
    queryKey: computed(() => ["maintenance", "work-order", target.value] as const),
    queryFn: () => {
      const t = target.value!;
      const path = "rowId" in t
        ? `/api/maintenance/work-orders/${encodeURIComponent(t.rowId)}`
        : `/api/maintenance/fleetpal-work-orders/${encodeURIComponent(t.fleetpalId)}`;
      return read<WorkOrderDetailDto>(path, "the work order");
    },
    enabled: computed(() => target.value !== null),
  });
}

/**
 * The files on a work order's invoices, asked of FleetPal live (never cached across opens: the list is
 * the vendor's, and a file attached a minute ago should show). Off until the record says there is an
 * invoice to ask about, so an order with none never calls FleetPal.
 */
export function useWorkOrderFilesQuery(rowId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["maintenance", "work-order-files", rowId.value] as const),
    queryFn: () => read<WorkOrderFilesDto>(`/api/maintenance/work-orders/${encodeURIComponent(rowId.value!)}/files`, "the work order's files"),
    enabled: computed(() => rowId.value !== null),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Where the drawer fetches one file's bytes from (through our API; FleetPal's link never reaches the browser). */
export const workOrderFilePath = (rowId: string, invoiceId: string, index: number) =>
  `/api/maintenance/work-orders/${encodeURIComponent(rowId)}/files/${encodeURIComponent(invoiceId)}/${index}`;
