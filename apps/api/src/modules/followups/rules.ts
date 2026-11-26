/**
 * The admin's rule overrides (WARNING-DESK-PLAN D-WD10). Only an override is stored; every default is
 * `resolveFollowUpRules` in packages/shared. Admin-only is enforced by the route (owner ruling
 * 2026-11-26: "only Admin set rules"); these functions trust their caller and org-scope every query.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpCategory, FollowUpRuleOverride, FollowUpSeverity } from "@silvicom/shared";

interface RuleRow {
  rule_key: string;
  enabled: boolean;
  threshold_count: number;
  window_days: number;
  min_active_hours: number;
  category: FollowUpCategory;
  severity: FollowUpSeverity;
}

export async function readRuleOverrides(admin: SupabaseClient, orgId: string): Promise<FollowUpRuleOverride[]> {
  const { data, error } = await admin
    .from("follow_up_rules")
    .select("rule_key, enabled, threshold_count, window_days, min_active_hours, category, severity")
    .eq("org_id", orgId);
  if (error) throw new Error(`follow_up_rules read: ${error.message}`);
  return ((data ?? []) as RuleRow[]).map((r) => ({
    ruleKey: r.rule_key,
    enabled: r.enabled,
    thresholdCount: r.threshold_count,
    windowDays: r.window_days,
    minActiveHours: r.min_active_hours,
    category: r.category,
    severity: r.severity,
  }));
}

/** Save one rule whole — every column, never a partial payload (`lint:upserts`). */
export async function saveRuleOverride(admin: SupabaseClient, orgId: string, o: FollowUpRuleOverride, actorId: string, now: Date): Promise<void> {
  const { error } = await admin.from("follow_up_rules").upsert(
    {
      org_id: orgId,
      rule_key: o.ruleKey,
      enabled: o.enabled,
      threshold_count: o.thresholdCount,
      window_days: o.windowDays,
      min_active_hours: o.minActiveHours,
      category: o.category,
      severity: o.severity,
      updated_by: actorId,
      updated_at: now.toISOString(),
    },
    { onConflict: "org_id,rule_key" },
  );
  if (error) throw new Error(`follow_up_rules save: ${error.message}`);
}

/** Back to the default: the override row goes. */
export async function clearRuleOverride(admin: SupabaseClient, orgId: string, ruleKey: string): Promise<void> {
  const { error } = await admin.from("follow_up_rules").delete().eq("org_id", orgId).eq("rule_key", ruleKey);
  if (error) throw new Error(`follow_up_rules clear: ${error.message}`);
}
