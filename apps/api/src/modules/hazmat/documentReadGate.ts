import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgHazmatPolicy } from "@silvicom/shared";

/**
 * The gate a `shipping_document` read passes before it spends (DOCUMENT-READER-PLAN.md Step 1.6, §2
 * "Gates already in the house, reused"). The shipping document's one consumer is the Hazmat Calculator
 * (Phase 3), whose photo path the reader replaces — so the org's HazmatGuard entitlement and its
 * OrgHazmatPolicy decide, exactly as they decide for `executeExtraction` today:
 *   - `org_module_enabled(…, 'hazmatguard')` — the entitlement;
 *   - `extractionEnabled` — the org's kill switch for reading BOL photos with a model;
 *   - `extractionMonthlyTokenBudget` — D17's budget, compared with the one org-wide counter both paths
 *     now write (`org_usage_month`, 0130 and 0451), so a carrier's budget covers both readers at once.
 *
 * It lives in the hazmat module and is wired to the reader at the composition root (the queue handler),
 * because the reader must not depend on hazmat (D-DR1). When a second consumer reads shipping documents
 * (stop readiness, Phase 6), whose gate a read passes becomes a question — the plan's Q-DR18.
 */
export async function shippingDocumentReadGate(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ open: boolean; monthlyTokenBudget: number | null }> {
  const { data: enabled, error } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" });
  if (error) throw new Error(`org_module_enabled: ${error.message}`);
  const { data: row, error: pErr } = await admin.from("hazmat_policies").select("policy").eq("org_id", orgId).maybeSingle();
  if (pErr) throw new Error(`hazmat_policies: ${pErr.message}`);
  // Read the way `executeExtraction` reads it, key by key, so the two readers cannot disagree about
  // one stored policy: only an explicit `false` turns reading off, and a missing budget is unlimited.
  const policy = ((row as { policy?: Partial<OrgHazmatPolicy> } | null)?.policy ?? {}) as Partial<OrgHazmatPolicy>;
  const extractionEnabled = policy.extractionEnabled !== false;
  const budget = policy.extractionMonthlyTokenBudget ?? null;
  return { open: enabled === true && extractionEnabled, monthlyTokenBudget: budget };
}
