import type { SupabaseClient } from "@supabase/supabase-js";
import { MODULE_KEYS, isModuleKey, type ModuleKey } from "@fuelguard/shared";

/** Per-org aggregate row returned by the platform_org_overview RPC. */
export interface OrgOverview {
  orgId: string;
  name: string;
  createdAt: string;
  memberCount: number;
  vehicleCount: number;
  activeVehicleCount: number;
  driverCount: number;
  openAnomalyCount: number;
  lastTxnAt: string | null;
}

interface OverviewRow {
  org_id: string;
  name: string;
  created_at: string;
  member_count: number | string;
  vehicle_count: number | string;
  active_vehicle_count: number | string;
  driver_count: number | string;
  open_anomaly_count: number | string;
  last_txn_at: string | null;
}

const toOverview = (r: OverviewRow): OrgOverview => ({
  orgId: r.org_id,
  name: r.name,
  createdAt: r.created_at,
  memberCount: Number(r.member_count) || 0,
  vehicleCount: Number(r.vehicle_count) || 0,
  activeVehicleCount: Number(r.active_vehicle_count) || 0,
  driverCount: Number(r.driver_count) || 0,
  openAnomalyCount: Number(r.open_anomaly_count) || 0,
  lastTxnAt: r.last_txn_at,
});

/** All customer orgs with aggregate stats (cross-tenant; service-role via the definer RPC). */
export async function listOrgs(admin: SupabaseClient): Promise<OrgOverview[]> {
  const { data, error } = await admin.rpc("platform_org_overview", { p_org_id: null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as OverviewRow[]).map(toOverview);
}

export interface OrgModule {
  provider: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}

/**
 * One sellable-module entitlement (org_modules, 0088) — a COMMERCIAL fact, distinct from
 * `OrgModule` above which is an INTEGRATION connection (org_integrations). The admin UI renders
 * them as separate cards ("Entitlements" vs "Integrations") to end the historical name collision.
 * Every catalog key is always present: absent row = never granted = disabled.
 */
export interface OrgEntitlement {
  moduleKey: ModuleKey;
  enabled: boolean;
  /** False when the org has no row at all (vs. an explicit disable). */
  granted: boolean;
}

export interface OrgDetail extends OrgOverview {
  allowedDomains: string[];
  operatingHours: unknown;
  modules: OrgModule[];
  entitlements: OrgEntitlement[];
}

/** One org's detail: aggregates + settings + enabled modules. Null if the org does not exist. */
export async function getOrgDetail(admin: SupabaseClient, orgId: string): Promise<OrgDetail | null> {
  const { data: rows, error } = await admin.rpc("platform_org_overview", { p_org_id: orgId });
  if (error) throw new Error(error.message);
  const row = ((rows ?? []) as OverviewRow[])[0];
  if (!row) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("allowed_domains, operating_hours")
    .eq("id", orgId)
    .maybeSingle();

  const { data: mods } = await admin
    .from("org_integrations")
    .select("provider, enabled, last_synced_at")
    .eq("org_id", orgId);

  const { data: ents } = await admin
    .from("org_modules")
    .select("module_key, enabled")
    .eq("org_id", orgId);
  const entRows = new Map(
    ((ents ?? []) as { module_key: string; enabled: boolean }[]).map((e) => [e.module_key, e.enabled]),
  );

  return {
    ...toOverview(row),
    allowedDomains: ((org as { allowed_domains?: string[] } | null)?.allowed_domains) ?? [],
    operatingHours: (org as { operating_hours?: unknown } | null)?.operating_hours ?? null,
    modules: ((mods ?? []) as { provider: string; enabled: boolean; last_synced_at: string | null }[]).map(
      (m) => ({ provider: m.provider, enabled: m.enabled, lastSyncedAt: m.last_synced_at }),
    ),
    // Every catalog key, always — the UI never has to guess what CAN be granted.
    entitlements: MODULE_KEYS.map((moduleKey) => ({
      moduleKey,
      enabled: entRows.get(moduleKey) ?? false,
      granted: entRows.has(moduleKey),
    })),
  };
}

/**
 * Grant / revoke a sellable-module entitlement (org_modules) — the platform control plane's write
 * (D-PM6/plan 5.3). Upsert, so the first grant creates the row; a revoke keeps the row with
 * enabled=false (an explicit commercial decision, distinct from never-granted). Callers audit.
 */
export async function setOrgEntitlement(
  admin: SupabaseClient,
  orgId: string,
  moduleKey: string,
  enabled: boolean,
  actorUserId: string | null,
): Promise<{ ok: true; moduleKey: ModuleKey } | { ok: false; error: string }> {
  if (!isModuleKey(moduleKey)) return { ok: false, error: `"${moduleKey}" is not a sellable module.` };
  const { error } = await admin.from("org_modules").upsert(
    {
      org_id: orgId,
      module_key: moduleKey,
      enabled,
      enabled_at: new Date().toISOString(),
      enabled_by: actorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,module_key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, moduleKey };
}
