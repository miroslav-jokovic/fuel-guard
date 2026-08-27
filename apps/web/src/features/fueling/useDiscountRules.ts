import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

// The contract lives in shared since P6.1 (the row shape the API validates writes with).
export { DISCOUNT_TYPES } from "@silvicom/shared";
export type { DiscountType, DiscountRuleRow as DiscountRule } from "@silvicom/shared";
import type { DiscountRuleRow as DiscountRule } from "@silvicom/shared";

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
      if (!session.orgId) throw new Error("No active organization.");
      // P6.1: replace-set semantics run server-side now (validated, admin-gated, audited).
      const clean = rules.map((r) => ({ ...r, brand: r.brand.trim().toLowerCase() })).filter((r) => r.brand);
      const r = await apiFetch("/api/fueling/discount-rules", { method: "POST", body: { rules: clean } });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save discount rules");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuel_discount_rules"] }),
  });
}
