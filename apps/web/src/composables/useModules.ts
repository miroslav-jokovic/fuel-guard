import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  moduleEnabled,
  moduleUnavailableMessage,
  toModuleSet,
  type ModuleKey,
  type OrgModule,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

/**
 * Module entitlements for the signed-in org (Phase 5E, D55) — layer 3 of the gate.
 *
 * Read straight from PostgREST because `org_modules` has a plain org-scoped SELECT policy: knowing
 * which modules your own company bought is not sensitive, and the UI needs the answer before it can
 * decide what to render. The *enforcement* lives in RLS and the API guard; this only decides whether
 * a nav item and its surfaces appear at all, so nobody is offered a button that 403s.
 *
 * Long `staleTime`: entitlements are a commercial fact that changes when a contract changes, not
 * something to re-poll every minute.
 */
const modulesKey = ["org", "modules"] as const;

export function useModulesQuery() {
  return useQuery({
    queryKey: modulesKey,
    queryFn: async (): Promise<OrgModule[]> => {
      const { data, error } = await supabase.from("org_modules").select("module_key, enabled, config");
      if (error) throw new Error(error.message);
      return (data ?? []) as OrgModule[];
    },
    staleTime: 10 * 60_000,
  });
}

export function useModules() {
  const { data, isPending } = useModulesQuery();
  const modules = computed(() => toModuleSet(data.value));

  return {
    modules,
    /**
     * While the query is in flight we answer **false** — better a nav item that appears a beat late
     * than one that flashes in and disappears, or worse, a surface a tenant has not bought rendering
     * for a moment before the answer arrives.
     */
    has: (key: ModuleKey) => computed(() => !isPending.value && moduleEnabled(modules.value, key)),
    unavailableMessage: moduleUnavailableMessage,
    isPending,
  };
}
