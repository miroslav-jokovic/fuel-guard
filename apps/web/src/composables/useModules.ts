import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { toModuleSet, type ModuleSet, type OrgModule } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * The org's enabled module set (Phase 5E / D55) — which products this tenant has bought.
 *
 * Read directly from `org_modules`; RLS (`org_modules_select`) scopes it to the caller's org, and there
 * is no in-tenant write policy (entitlements are a commercial fact set by the control plane). The API
 * (`requireModule`) and RLS are the real enforcement — this query only drives UI gating so a customer
 * never sees a surface they can't use. While the query is in flight the set is empty, so a gated surface
 * fades IN once confirmed rather than flashing and disappearing.
 *
 * ── KEYED BY THE ORG, AND ASKED ONLY WITH ONE (2026-10-13) ─────────────────────────────────────
 * The key was `["org_modules"]` alone, so the cache could hold an answer that belonged to nobody.
 * Measured on staging, signing in as a fleet manager: the shell mounted for a moment on `/login`
 * before the router had resolved it, this read went out with the ANON key, RLS answered `[]` — an
 * empty set, not an error — and that empty set was cached for five minutes. After sign-in the shell
 * found a fresh answer and did not ask again, so every `module: "dispatch"` surface was hidden (Loads,
 * the Dispatch board, two Operations cards) until a reload. `App.vue` now waits for the router; this
 * is the half that holds whatever mounts early: with no org there is no question to ask, and a new
 * org is a new cache entry rather than the old one's answer.
 */
export function useModulesQuery() {
  const session = useSessionStore();
  const orgId = computed(() => session.orgId);
  return useQuery({
    queryKey: ["org_modules", orgId] as const,
    enabled: computed(() => !!orgId.value),
    queryFn: async (): Promise<ModuleSet> => {
      const { data, error } = await supabase.from("org_modules").select("module_key, enabled, config");
      if (error) throw new Error(error.message);
      return toModuleSet((data ?? []) as OrgModule[]);
    },
    staleTime: 5 * 60 * 1000,
  });
}
