import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveFeatures,
  toModuleSet,
  type FeatureOverrideRow,
  type FeatureState,
  type OrgFeatureRow,
  type OrgModule,
} from "@fuelguard/shared";

/**
 * DB-facing half of the feature control plane (hardening plan Phase 4). Fetches the org's feature
 * rows + this driver's overrides and hands them to the ONE pure resolution rule
 * (`resolveFeatures`, unit-tested in shared). The app receives only the resolved output on the
 * bootstrap — a driver JWT can never read these tables directly (0134: RLS on, zero policies).
 *
 * Read failures FAIL SOFT to "no rows" (catalog defaults): the bootstrap must not 500 — and
 * catalog defaults exactly preserve current behavior, so a transient read error degrades to
 * yesterday's app, not a broken one.
 */
export async function getResolvedFeatures(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  modules: readonly OrgModule[],
): Promise<FeatureState[]> {
  const [orgRes, overrideRes] = await Promise.all([
    admin.from("driver_app_features").select("feature_key, enabled, config").eq("org_id", orgId),
    admin
      .from("driver_app_feature_overrides")
      .select("feature_key, enabled")
      .eq("org_id", orgId)
      .eq("driver_id", driverId),
  ]);
  const orgRows = (orgRes.data ?? []) as OrgFeatureRow[];
  const overrideRows = (overrideRes.data ?? []) as FeatureOverrideRow[];
  return resolveFeatures(toModuleSet(modules), orgRows, overrideRows);
}
