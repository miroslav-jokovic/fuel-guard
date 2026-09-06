import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { computed } from "vue";
import { fuelPolicyFromSettings, routeFuelSettingsFormSchema, type FuelPolicy, type RouteFuelSettingsForm } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * Every column the form round-trips, DERIVED from the form's own schema rather than listed.
 *
 * ── THE DEFECT THIS REPLACES, WHICH WAS ONE DAY OLD AND WOULD HAVE DESTROYED DATA ───────────────
 * C8 added three target fields to the form and to `routeFuelSettingsFormSchema`, and this list was
 * hand-written, so it did not select them. The read therefore returned no targets, the form fell back
 * to its defaults — `null`, correctly — and `saveRouteFuelSettings` upserts `{ org_id, ...form }`.
 * Opening Settings → Planned Fueling and pressing Save would have written those nulls over the
 * targets an owner had just set, silently, with the page showing blank fields that looked like the
 * truth.
 *
 * A hand-written mirror of a schema is a copy with a delay fuse — the shape CLAUDE.md's no-workarounds
 * rule names — and the fuse here was one save long. Deriving from the schema means a field added to
 * the form is selected by the read that fills it, with nothing to remember.
 */
export const ROUTE_FUEL_SETTINGS_COLS = Object.keys(routeFuelSettingsFormSchema.shape).join(", ");

export type RouteFuelSettings = RouteFuelSettingsForm;

/** The org's planned-fueling settings (null → not configured yet; the UI shows defaults). */
export function useRouteFuelSettings() {
  return useQuery({
    queryKey: ["route_fuel_settings"],
    queryFn: async (): Promise<Partial<RouteFuelSettings> | null> => {
      const { data, error } = await supabase.from("route_fuel_settings").select(ROUTE_FUEL_SETTINGS_COLS).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Partial<RouteFuelSettings> | null) ?? null;
    },
    refetchInterval: 120_000,
  });
}

/** Save the org's planned-fueling settings (admin only, enforced by RLS). */
export function useSaveRouteFuelSettings() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (form: RouteFuelSettingsForm): Promise<void> => {
      if (!session.orgId) throw new Error("No active organization.");
      const { error } = await supabase
        .from("route_fuel_settings")
        .upsert({ org_id: session.orgId, ...form, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["route_fuel_settings"] }),
  });
}

/**
 * The org's fuel policy — which states to avoid, which brands, which are preferred.
 *
 * ── WHY THIS SITS ON THE SETTINGS QUERY RATHER THAN BESIDE IT ────────────────────────────────────
 * The same three columns drive two surfaces that must never disagree: the route planner, which has
 * honoured them since 0058, and the compliance tabs on the fuel-spend page, which until F3 measured a
 * hardcoded `{CA}` / `{one9}` regardless of what the org had configured. A second query would give the
 * two surfaces two caches and therefore two moments at which they can disagree; this reads the one
 * that already exists, so saving the settings page invalidates both at once.
 *
 * `fuelPolicyFromSettings` (shared, tested) does the mapping — including the null-vs-empty distinction
 * the planner's own resolver deliberately merges. Falls back to the module defaults while the query is
 * still loading, which is the same answer an unconfigured org gets.
 */
export function useFuelPolicy() {
  const { data } = useRouteFuelSettings();
  return computed<FuelPolicy>(() => fuelPolicyFromSettings(data.value ?? null));
}
