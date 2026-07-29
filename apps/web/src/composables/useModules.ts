import { useQuery } from "@tanstack/vue-query";
import { toModuleSet, type ModuleSet, type OrgModule } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

/**
 * The org's enabled module set (Phase 5E / D55) — which products this tenant has bought.
 *
 * Read directly from `org_modules`; RLS (`org_modules_select`) scopes it to the caller's org, and there
 * is no in-tenant write policy (entitlements are a commercial fact set by the control plane). The API
 * (`requireModule`) and RLS are the real enforcement — this query only drives UI gating so a customer
 * never sees a surface they can't use. While the query is in flight the set is empty, so a gated surface
 * fades IN once confirmed rather than flashing and disappearing.
 */
export function useModulesQuery() {
  return useQuery({
    queryKey: ["org_modules"],
    queryFn: async (): Promise<ModuleSet> => {
      const { data, error } = await supabase.from("org_modules").select("module_key, enabled, config");
      if (error) throw new Error(error.message);
      return toModuleSet((data ?? []) as OrgModule[]);
    },
    staleTime: 5 * 60 * 1000,
  });
}
