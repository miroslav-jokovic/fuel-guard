/**
 * Creating a fill-up — the one WRITE the fuel log performs, and the reason it lives here.
 *
 * Split out of `useFuelLog.ts` when its read half was promoted to `@/composables/` so the dashboard
 * could use it without one feature reaching into another (`lint:boundaries`). The write could not go
 * with it: `check-table-modules.mjs` owns `fuel_transactions` to the `fuel` module, and a write from
 * `composables/` is outside that owner. Two gates disagreeing was the useful signal — the READ the
 * dashboard wanted and the WRITE the fuel log performs are different things, and only one of them is
 * shared. Moving this back means the grandfather entry the module gate carried for it is deleted
 * rather than repointed, which is the ratchet those lists exist to allow.
 */
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { derivePricePerGal, type FillUpInput } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { compressToWebp } from "./imageCompress";

/** Create a fill-up: optional compressed receipt upload, then insert (engine scoring lands in Phase 5). */
export function useCreateFillUp() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async ({ input, file }: { input: FillUpInput; file?: File | null }): Promise<void> => {
      if (!session.orgId) throw new Error("No organization in session");

      let receiptPath: string | null = null;
      if (file) {
        const blob = await compressToWebp(file);
        const path = `${session.orgId}/${input.vehicle_id}/${input.id}.webp`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, blob, { contentType: "image/webp", upsert: true });
        if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
        receiptPath = path;
      }

      const row = {
        id: input.id,
        org_id: session.orgId,
        vehicle_id: input.vehicle_id,
        driver_id: input.driver_id ?? null,
        fueled_at: input.fueled_at,
        odometer: input.odometer ?? null,
        gallons: input.gallons,
        total_cost: input.total_cost ?? null,
        price_per_gal: derivePricePerGal(input.gallons, input.total_cost ?? null),
        location_text: input.location_text ?? null,
        payment_method: input.payment_method ?? null,
        receipt_path: receiptPath,
        source: "manual",
        entered_by: session.userId,
      };
      const { error } = await supabase.from("fuel_transactions").insert(row);
      if (error) throw new Error(error.message);

      // Best-effort server-side scoring (anomaly engine). The fill-up is saved regardless.
      try {
        await apiFetch(`/api/transactions/${input.id}/score`, { method: "POST" });
      } catch {
        /* scoring can be retried; never block the save */
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_transactions"] });
      qc.invalidateQueries({ queryKey: ["anomalies"] });
    },
  });
}
