import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

export const DISCOUNT_TYPES = ["flat", "retail_minus", "cost_plus", "per_site", "none"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface DiscountRule {
  brand: string;
  type: DiscountType;
  cents_off: number;
}

/** All per-brand discount rules for the org (for chains that quote posted price + a contract discount). */
export function useDiscountRules() {
  return useQuery({
    queryKey: ["fuel_discount_rules"],
    queryFn: async (): Promise<DiscountRule[]> => {
      const { data, error } = await supabase.from("fuel_discount_rules").select("brand, type, cents_off").order("brand");
      if (error) throw new Error(error.message);
      return (data as DiscountRule[] | null) ?? [];
    },
    refetchInterval: 120_000,
  });
}

/** Replace the org's discount rules (admin only, enforced by RLS): upsert present, remove the rest. */
export function useSaveDiscountRules() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (rules: DiscountRule[]): Promise<void> => {
      const orgId = session.orgId;
      if (!orgId) throw new Error("No active organization.");
      const clean = rules
        .map((r) => ({ ...r, brand: r.brand.trim().toLowerCase() }))
        .filter((r) => r.brand);
      const rows = clean.map((r) => ({ org_id: orgId, brand: r.brand, type: r.type, cents_off: r.cents_off, updated_at: new Date().toISOString() }));
      if (rows.length) {
        const { error } = await supabase.from("fuel_discount_rules").upsert(rows, { onConflict: "org_id,brand" });
        if (error) throw new Error(error.message);
      }
      // Remove any brand the admin deleted from the list.
      const keep = clean.map((r) => r.brand);
      let del = supabase.from("fuel_discount_rules").delete().eq("org_id", orgId);
      if (keep.length) del = del.not("brand", "in", `(${keep.join(",")})`);
      const { error: delErr } = await del;
      if (delErr) throw new Error(delErr.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuel_discount_rules"] }),
  });
}
