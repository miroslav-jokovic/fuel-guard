import type { SupabaseClient } from "@supabase/supabase-js";
import card from "./launchReadiness.json" with { type: "json" };

/**
 * A real launch waits for L4 (ADS-AGENT-BUILD-WORKFLOW.md §4R: "Production launch (L5) is refused in code unless the
 * scorecard shows L4 for every worker the campaign uses"). `launchReadiness.json` is that scorecard as committed at the
 * deployed sha, written from the registry by `scripts/check-ads-readiness.mjs`, whose gate fails if the two disagree.
 *
 * ── WHAT COUNTS AS REAL ───────────────────────────────────────────────────────────────────────────
 * Only a `simulator` connection or a sandbox account is exempt, because L4 is earned on them: the refusal would
 * otherwise stop the certification it asks for. Everything else counts as real, including a connection that cannot be
 * read, so a new provider or a lost row is refused rather than waved through. The environment is not asked: a real
 * ad account spends real money from a staging host too, and `simulatorGate` already keeps the simulator off production.
 *
 * Which workers a first campaign uses is the registry's (`notAtLaunch`), never a list here.
 */
export interface LaunchCard {
  required: string[];
  certified: string[];
}

export const workersBelowL4 = (c: LaunchCard): string[] => c.required.filter((w) => !c.certified.includes(w));

/** The workers that stop this campaign launching on this connection; empty = nothing does. */
export async function launchBlockedBy(admin: SupabaseClient, orgId: string, connectionId: string, c: LaunchCard = card): Promise<string[]> {
  const { data, error } = await admin.from("ads_platform_connections").select("provider, is_sandbox").eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = data as { provider: string; is_sandbox: boolean } | null;
  return row && (row.provider === "simulator" || row.is_sandbox) ? [] : workersBelowL4(c);
}
