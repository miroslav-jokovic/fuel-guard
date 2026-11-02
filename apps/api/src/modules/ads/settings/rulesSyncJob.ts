import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { syncAutomatedRules, type RuleOutcome } from "../platforms/meta/rulesSync.js";
import { graphForConnection } from "../platforms/registry.js";
import { settingsInForce } from "./settingsVersions.js";

/**
 * One org's `ads_rules_sync` job (B3b): the settings in force → every connected Meta (or simulator)
 * account's Automated Rules. Queued by the settings save door; the job, not the request, talks to
 * Meta. A connection whose client cannot be opened is reported, not skipped silently.
 *
 * Returns what happened per connection; the handler throws when any sync FAILED, so the job ends
 * failed and is listed on the failed-jobs page (E5) — a rule Meta refused (2703) is not a failure.
 */
export interface OrgRulesSyncDeps {
  admin: SupabaseClient;
  env: Env;
  now: () => Date;
}

export interface OrgRulesSyncResult {
  settings_version: number | null;
  connections: Array<{ connection_id: string; ok: boolean; error_code?: string; results: RuleOutcome[] }>;
}

export async function syncOrgRules(deps: OrgRulesSyncDeps, orgId: string): Promise<OrgRulesSyncResult> {
  const inForce = await settingsInForce(deps.admin, orgId);
  const { data, error } = await deps.admin
    .from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, account_ref, status")
    .eq("org_id", orgId)
    .in("provider", ["meta", "simulator"])
    .eq("status", "connected");
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const out: OrgRulesSyncResult = { settings_version: inForce.version, connections: [] };
  for (const c of (data ?? []) as Array<{ id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; account_ref: string | null }>) {
    const opened = await graphForConnection(deps, c);
    if (!opened.ok || !c.account_ref) {
      out.connections.push({ connection_id: c.id, ok: false, error_code: opened.ok ? "no_account" : opened.error_code, results: [] });
      continue;
    }
    const r = await syncAutomatedRules({ admin: deps.admin, graph: opened.graph, now: deps.now }, {
      orgId, connectionId: c.id, accountId: c.account_ref, code: c.provider === "simulator" ? "SIM" : "META",
      settings: inForce.settings, settingsVersion: inForce.version,
    });
    out.connections.push({ connection_id: c.id, ok: r.ok, results: r.results });
  }
  return out;
}
