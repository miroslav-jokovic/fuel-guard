import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteFuelSettingsForm } from "@silvicom/shared";

/**
 * Save the org's planned-fueling settings — the write half of Settings → Planned fueling, whose read
 * stays on PostgREST (client select policy, org-scoped). Until SP2 the browser upserted this table
 * directly (SETTINGS-PERMISSIONS-PLAN.md); the write now comes through the owner, gated on the
 * screen's own permission and audited, like thresholds did at P6.1. Full-form upsert on the org PK:
 * every column the form does not carry has a default (0058, 0063, 0065), so the proposed tuple
 * passes NOT NULL before conflict arbitration (lint:upserts).
 */
export async function saveRouteFuelSettings(admin: SupabaseClient, orgId: string, form: RouteFuelSettingsForm): Promise<void> {
  const { error } = await admin
    .from("route_fuel_settings")
    .upsert({ org_id: orgId, ...form, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) throw new Error(`route_fuel_settings upsert failed: ${error.message}`);
}
