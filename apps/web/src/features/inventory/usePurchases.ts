import { computed, type Ref } from "vue";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  DocumentRegisterResponse,
  DocumentRow,
  EquipmentPurchaseDetail,
  EquipmentPurchaseDto,
  EquipmentPurchaseInput,
  FleetpalOrderRef,
  PurchaseDocumentRegisterRequest,
} from "@silvicom/shared";
import { recordOrThrow } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { uploadDocumentFile } from "@/composables/useCompliance";

/**
 * Equipment bills, client side (M10b, 0530; `inventoryPurchaseContract.ts`).
 *
 * The keys sit under `["inventory", …]` with the rest of the feature (`useAssets.ts` says why): a
 * recorded bill changes the items it paid for — each one's page now names it — so one invalidation of
 * the prefix refreshes both halves.
 *
 * ⚠ The bill's id is minted by the DRAWER, once per opening, never here (D-INV27). A `mutationFn` that
 * called `crypto.randomUUID()` would mint one per attempt, and a save pressed twice on a bad connection
 * would type the bill twice — the second refused as a duplicate, after the first had landed.
 */

const BASE = "/api/maintenance/inventory/purchases";
export const PURCHASES_PAGE_SIZE = 50;

export function usePurchasesQuery(filter: Ref<{ search?: string; page: number }>) {
  return useQuery({
    queryKey: ["inventory", "purchases", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ purchases: EquipmentPurchaseDto[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams({
        limit: String(PURCHASES_PAGE_SIZE),
        offset: String((f.page - 1) * PURCHASES_PAGE_SIZE),
      });
      if (f.search) params.set("search", f.search);
      const r = await apiFetch<{ purchases: EquipmentPurchaseDto[]; total: number }>(`${BASE}?${params}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the invoices");
      return r.data;
    },
  });
}

export function usePurchaseQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "purchase", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<EquipmentPurchaseDetail> =>
      recordOrThrow(await apiFetch<{ purchase: EquipmentPurchaseDetail }>(`${BASE}/${id.value}`), "Could not load the invoice")
        .purchase,
  });
}

/** The paper. Its own query, read fresh: each row carries a signed URL that lives five minutes. */
export function usePurchaseDocumentsQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "purchase-documents", id] as const,
    enabled: computed(() => Boolean(id.value)),
    staleTime: 0,
    queryFn: async (): Promise<DocumentRow[]> => {
      const r = await apiFetch<{ data: DocumentRow[] }>(`${BASE}/${id.value}/documents`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the paper");
      return r.data.data;
    },
  });
}

/** FleetPal's purchase orders a bill can link, newest first. */
export function useFleetpalOrdersQuery(search: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ["inventory", "fleetpal-orders", search] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FleetpalOrderRef[]> => {
      const q = search.value.trim() ? `?search=${encodeURIComponent(search.value.trim())}` : "";
      const r = await apiFetch<{ orders: FleetpalOrderRef[] }>(`${BASE}/fleetpal-orders${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load FleetPal's purchase orders");
      return r.data.orders;
    },
  });
}

/**
 * Record a bill, or a correction of one (`supersedes`), then file its paper against it.
 *
 * Two steps, in that order, because the paper's subject is the bill: the document route refuses a bill
 * that is not on file. If the paper fails after the bill landed, the error says so — the bill is kept
 * and the paper can be filed from its page — rather than reading as though nothing was saved.
 */
export function useRecordPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bill: EquipmentPurchaseInput; paper: File | null }): Promise<EquipmentPurchaseDetail> => {
      const r = await apiFetch<{ purchase: EquipmentPurchaseDetail }>(BASE, { method: "POST", body: input.bill });
      if (!r.ok || !r.data) {
        throw Object.assign(new Error(r.error?.message ?? "Could not record the invoice"), { code: r.error?.code });
      }
      if (input.paper) {
        try {
          await fileInvoicePaper(input.bill.id, input.paper);
        } catch (e) {
          throw Object.assign(
            new Error(`The invoice was saved, but its paper was not: ${e instanceof Error ? e.message : "try again"}. File it from the invoice.`),
            { code: "paper_failed", saved: r.data.purchase },
          );
        }
      }
      return r.data.purchase;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

async function fileInvoicePaper(purchaseId: string, file: File): Promise<void> {
  await uploadDocumentFile(file, async (fields) => {
    const body: PurchaseDocumentRegisterRequest = fields;
    const res = await apiFetch<{ data: DocumentRegisterResponse }>(`${BASE}/${purchaseId}/documents`, { method: "POST", body });
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The paper could not be filed.");
    return res.data.data;
  });
}

/** File (more) paper against a bill already on record — the detail drawer's drop zone. */
export function useFileInvoicePaper(id: Ref<string>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => fileInvoicePaper(id.value, file),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
