import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEATURE_CATALOG,
  isFeatureKey,
  validateFeatureConfig,
  type DriverAppOverrideRow,
  type FeatureKey,
  type OrgFeatureRow,
} from "@fuelguard/shared";

/**
 * Dashboard control-plane services (hardening plan Phase 5.1/5.2). The ONLY door to
 * `driver_app_features` / `driver_app_feature_overrides` — 0134 ships RLS-on with zero policies,
 * so every read and write flows through here (service role) behind the router's role guards.
 * Config is validated against the catalog schema BEFORE storage; unreleased keys are rejected at
 * the write door so the dashboard can never store a toggle that does nothing (D-PM5).
 */

export type SettingsError = { code: string; error: string };
const err = (code: string, error: string): SettingsError => ({ code, error });
export const isSettingsError = (v: unknown): v is SettingsError =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;

/** A writable key: known AND released. `core.app` is writable (its config is the point). */
function writableKey(key: string): FeatureKey | SettingsError {
  if (!isFeatureKey(key)) return err("unknown_feature", `"${key}" is not a driver-app feature.`);
  if (!FEATURE_CATALOG[key].released) {
    return err("feature_unreleased", `"${key}" isn't available yet — it cannot be configured.`);
  }
  return key;
}

export async function listOrgFeatures(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ rows: OrgFeatureRow[] } | SettingsError> {
  const { data, error } = await admin
    .from("driver_app_features")
    .select("feature_key, enabled, config, updated_at")
    .eq("org_id", orgId);
  if (error) return err("query_failed", "Could not load driver-app settings.");
  return { rows: (data ?? []) as OrgFeatureRow[] };
}

export async function upsertOrgFeature(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  key: string,
  input: { enabled: boolean; config?: Record<string, unknown> },
): Promise<{ featureKey: FeatureKey; enabled: boolean; config: Record<string, unknown> } | SettingsError> {
  const featureKey = writableKey(key);
  if (isSettingsError(featureKey)) return featureKey;
  if (featureKey === "core.app" && !input.enabled) {
    return err("invalid_feature", "App policy cannot be disabled; configure its minimum version instead.");
  }
  const cfg = validateFeatureConfig(featureKey, input.config);
  if (!cfg.ok) return err("invalid_config", cfg.error);
  const { error } = await admin.from("driver_app_features").upsert(
    {
      org_id: orgId,
      feature_key: featureKey,
      enabled: input.enabled,
      config: cfg.config,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,feature_key" },
  );
  if (error) return err("update_failed", "Could not save the setting.");
  return { featureKey, enabled: input.enabled, config: cfg.config };
}

/** The driver must exist in THIS org — an override for a foreign driver id is a not-found, never a write. */
async function driverInOrg(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  const { data } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  return data !== null;
}

export async function listOverrides(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ rows: DriverAppOverrideRow[] } | SettingsError> {
  if (!(await driverInOrg(admin, orgId, driverId))) return err("not_found", "Driver not found.");
  const { data, error } = await admin
    .from("driver_app_feature_overrides")
    .select("driver_id, feature_key, enabled, note, updated_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  if (error) return err("query_failed", "Could not load the driver's overrides.");
  return { rows: (data ?? []) as DriverAppOverrideRow[] };
}

export async function upsertOverride(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  driverId: string,
  key: string,
  input: { enabled: boolean; note?: string | null },
): Promise<{ featureKey: FeatureKey } | SettingsError> {
  const featureKey = writableKey(key);
  if (isSettingsError(featureKey)) return featureKey;
  if (featureKey === "core.app") return err("invalid_feature", "App policy has no per-driver form.");
  if (!(await driverInOrg(admin, orgId, driverId))) return err("not_found", "Driver not found.");
  const { error } = await admin.from("driver_app_feature_overrides").upsert(
    {
      org_id: orgId,
      driver_id: driverId,
      feature_key: featureKey,
      enabled: input.enabled,
      note: input.note ?? null,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,driver_id,feature_key" },
  );
  if (error) return err("update_failed", "Could not save the override.");
  return { featureKey };
}

export async function deleteOverride(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  key: string,
): Promise<{ featureKey: FeatureKey } | SettingsError> {
  const featureKey = writableKey(key);
  if (isSettingsError(featureKey)) return featureKey;
  if (!(await driverInOrg(admin, orgId, driverId))) return err("not_found", "Driver not found.");
  const { error } = await admin
    .from("driver_app_feature_overrides")
    .delete()
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("feature_key", featureKey);
  if (error) return err("update_failed", "Could not remove the override.");
  return { featureKey };
}
