import type { SupabaseClient } from "@supabase/supabase-js";
import type { PerformanceSettingsForm } from "@silvicom/shared";

/**
 * Save the org's driver-performance settings — the write half of the settings surface (reads
 * stay on PostgREST). Browser-direct until P6.1; now validated, gated and audited through the
 * owner. Full-row upsert on the org PK (lint:upserts).
 */
export async function savePerformanceSettings(
  admin: SupabaseClient,
  orgId: string,
  form: PerformanceSettingsForm,
): Promise<void> {
  const { error } = await admin
    .from("driver_performance_settings")
    .upsert({ org_id: orgId, ...form, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) throw new Error(`driver_performance_settings upsert failed: ${error.message}`);
}
