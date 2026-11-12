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

/**
 * The carrier's "Monthly AI usage limit, in tokens" (Thresholds page), or null when none is set — which
 * is `withinBudget`'s "unlimited". Read by Ask AI's gate (F21 R2), the first code to enforce it: the
 * setting had been saved since 0003 and compared with nothing (AUDIT P2).
 */
export async function readAiTokenBudget(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data, error } = await admin.from("anomaly_thresholds").select("ai_monthly_token_budget").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`anomaly_thresholds: ${error.message}`);
  const v = (data as { ai_monthly_token_budget: number | string | null } | null)?.ai_monthly_token_budget;
  return v == null ? null : Number(v);
}
