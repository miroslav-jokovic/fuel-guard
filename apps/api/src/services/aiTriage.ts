import type { SupabaseClient } from "@supabase/supabase-js";
import { CASE_RULE_ID } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { verifyTransaction } from "./aiVerification.js";

export interface TriageResult {
  cases: number; // open cases considered
  assessed: number; // AI assessments produced this run
}

/**
 * Auto-triage: run the AI investigator across OPEN theft cases that don't yet have an assessment, so
 * the queue can be ranked by true theft likelihood and likely false alarms surfaced. Budget-aware (the
 * verifier enforces the org's monthly token budget) and idempotent — cases already assessed are skipped,
 * so re-running only fills gaps.
 */
export async function triageOpenCases(admin: SupabaseClient, env: Env, orgId: string): Promise<TriageResult> {
  const { data: cases } = await admin
    .from("anomalies")
    .select("transaction_id")
    .eq("org_id", orgId)
    .eq("rule_id", CASE_RULE_ID)
    .in("status", ["open", "investigating"]);

  const txnIds = [...new Set(((cases ?? []) as { transaction_id: string }[]).map((c) => c.transaction_id))];
  let assessed = 0;
  for (const txnId of txnIds) {
    const { data: existing } = await admin
      .from("ai_verifications")
      .select("id")
      .eq("org_id", orgId)
      .eq("transaction_id", txnId)
      .limit(1)
      .maybeSingle();
    if (existing) continue; // already assessed — skip to respect the token budget

    // force=true bypasses the severity gate (so 'review' cases are triaged too); the monthly token
    // budget is still enforced inside the verifier and stops the run cleanly when exhausted.
    const out = await verifyTransaction(admin, env, orgId, txnId, { force: true }).catch(() => null);
    if (out) assessed++;
  }
  return { cases: txnIds.length, assessed };
}
