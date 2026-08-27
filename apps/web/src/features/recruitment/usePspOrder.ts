import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { PspOrderPreflight } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/psp-orders` — the surface P6 and P7 were built behind (P9). */

const preflightKey = (driverId: string) => ["recruitment", "psp-preflight", driverId] as const;

/**
 * What ordering would cost and what stands in the way. Free to ask — it makes no vendor call — so it
 * loads with the drawer rather than after somebody has committed to anything.
 */
export function usePspPreflightQuery(driverId: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => preflightKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value) && enabled.value),
    // The budget moves when anyone in the org orders, and a stale "3 remaining" is the number
    // somebody would approve a spend against.
    staleTime: 0,
    queryFn: async (): Promise<PspOrderPreflight> => {
      const res = await apiFetch<PspOrderPreflight>(
        `/api/recruitment/psp-orders/preflight?driverId=${driverId.value}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not check the PSP order.");
      return res.data;
    },
  });
}

export interface PspOrderOutcome {
  requestId: string;
  clean: boolean;
  recordId: string | null;
  documentId: string | null;
  report: { outcome: string; billed: boolean; summary?: unknown };
}

/** The refusal codes the drawer reacts to rather than merely printing. */
export type PspOrderRefusal = { code: string; message: string };

/**
 * Placing the order. `apiFetch` attaches the step-up token when one is held, which is what turns a
 * `step_up_required` refusal into "prompt, then press the same button again" rather than a dead end.
 */
export function useOrderPspRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string): Promise<PspOrderOutcome> => {
      const res = await apiFetch<PspOrderOutcome>("/api/recruitment/psp-orders", {
        method: "POST",
        body: { driver_id: driverId },
      });
      if (!res.ok || !res.data) {
        const refusal: PspOrderRefusal = {
          code: res.error?.code ?? "order_failed",
          message: res.error?.message ?? "Could not order the PSP record.",
        };
        throw Object.assign(new Error(refusal.message), refusal);
      }
      return res.data;
    },
    onSuccess: () => {
      // The record lands in the qualification file and the month's budget has moved.
      void qc.invalidateQueries({ queryKey: ["compliance"] });
      void qc.invalidateQueries({ queryKey: ["recruitment", "psp-preflight"] });
    },
  });
}
