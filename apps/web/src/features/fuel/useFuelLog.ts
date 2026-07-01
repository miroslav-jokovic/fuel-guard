import { type Ref, toValue } from "vue";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { derivePricePerGal, type FillUpInput, type FuelTransaction } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { compressToWebp } from "./imageCompress";

const FUEL_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at";

export const FUEL_PAGE_SIZE = 25;

export interface FuelFilters {
  vehicleId?: string;
  driverId?: string;
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
}

/** Keyset-paginated fuel log (audit M4), newest first, scoped + filtered. */
export function useFuelTransactions(filters: Ref<FuelFilters>) {
  return useInfiniteQuery({
    queryKey: ["fuel_transactions", filters],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<FuelTransaction[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("fuel_transactions")
        .select(FUEL_COLS)
        .order("fueled_at", { ascending: false })
        .limit(FUEL_PAGE_SIZE);
      if (pageParam) q = q.lt("fueled_at", pageParam);
      if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
      if (f.driverId) q = q.eq("driver_id", f.driverId);
      if (f.from) q = q.gte("fueled_at", f.from);
      if (f.to) q = q.lte("fueled_at", f.to);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as FuelTransaction[];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length === FUEL_PAGE_SIZE ? lastPage[lastPage.length - 1]!.fueled_at : undefined,
  });
}

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
