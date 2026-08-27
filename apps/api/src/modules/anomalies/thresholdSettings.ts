import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThresholdsForm } from "@silvicom/shared";

/**
 * Save the org's anomaly thresholds — the write half of a settings surface whose reads stay on
 * PostgREST (client select policy, org-scoped). Until P6.1 the BROWSER upserted this table
 * directly; the write now comes through the owner so it can be validated, gated and audited
 * like every other state change. Full-row upsert on the org PK (lint:upserts).
 */
export async function saveThresholds(admin: SupabaseClient, orgId: string, form: ThresholdsForm): Promise<void> {
  const { error } = await admin
    .from("anomaly_thresholds")
    .upsert({ org_id: orgId, ...form }, { onConflict: "org_id" });
  if (error) throw new Error(`anomaly_thresholds upsert failed: ${error.message}`);
}
