import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The quarterly IFTA reads, made server-side. Until program step P1.10 (2026-08-27) the harness
 * was a browser hook calling the 0256/0258 RPCs straight into the samsara collector's staging
 * tables — the exact browser→staging path ARCHITECTURE §1 forbids. The RPCs themselves are
 * unchanged (applied migrations are never edited); what changed is WHO calls them: this module,
 * with the service role, passing `p_org` explicitly because a service-role call carries no JWT
 * claim for the in-function `coalesce(p_org, auth_org_id())` default to fall back on.
 */
export interface IftaPeriodRows {
  jurisdictions: Record<string, unknown>[];
  summary: Record<string, unknown> | null;
}

export async function readIftaPeriod(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
): Promise<IftaPeriodRows> {
  const args = { p_org: orgId, p_year: year, p_quarter: quarter };
  const [jurisdictions, summaryRows] = await Promise.all([
    admin.rpc("ifta_period_jurisdictions", args),
    admin.rpc("ifta_period_summary", args),
  ]);
  if (jurisdictions.error) throw new Error(jurisdictions.error.message);
  if (summaryRows.error) throw new Error(summaryRows.error.message);
  return {
    jurisdictions: (jurisdictions.data ?? []) as Record<string, unknown>[],
    summary: ((summaryRows.data ?? []) as Record<string, unknown>[])[0] ?? null,
  };
}
