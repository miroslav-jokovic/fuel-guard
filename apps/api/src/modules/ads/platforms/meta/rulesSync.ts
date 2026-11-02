import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_RULE_PREFIX, rulesSpec, type AdRulePlatformCode, type AdRuleSpec, type AdsSettings } from "@silvicom/shared";
import { completeAction, startAction } from "../../actions/actionLedger.js";
import type { GraphResult, MetaGraph } from "./graphClient.js";

/**
 * Keep Meta's Automated Rules equal to the settings in force (B3b; `adsRulesSpec.ts` says what each rule
 * is and why only our ad sets are touched). Run after every settings save, through the queue
 * (`ads_rules_sync`), never inside the save request: a slow Meta must not hold an admin's Save open.
 *
 * A diff, so running it twice is running it once:
 *   · a rule the settings want, found by its name and the same → unchanged;
 *   · found but different, or disabled → updated (its specs rewritten, ENABLED);
 *   · not found → created;
 *   · one of OURS the settings no longer want → DISABLED, not deleted — the rule's history stays in Ads
 *     Manager, and turning the threshold back on re-enables it.
 * Two rules carrying one of our names are refused (`duplicate_rule`), never a guess at which to keep.
 * Meta refusing a rule (2703, U2) is recorded `refused` and does not stop the others; our monitor (B5)
 * remains that threshold's only enforcer, which the workflow's U2 fallback names.
 *
 * Each run is one `ads_actions` `rules_sync` row, started before the first call, completed with every
 * rule's outcome. No idempotency key: a repeat is harmless by construction, and the row per run is the
 * audit of who changed what on the platform and when.
 *
 * ⚠ Meta may hand specs back normalised (key order, number formats). A spec compared unequal is
 * rewritten — harmless, since an update sets the same values — so the cost of a mismatch is one write,
 * never a wrong rule. L4 on the sandbox measures whether "unchanged" is ever reached for real.
 */

export interface RulesSyncInput {
  orgId: string;
  connectionId: string;
  accountId: string;
  code: AdRulePlatformCode;
  settings: AdsSettings;
  settingsVersion: number | null;
}

export type RuleOutcome =
  | { key: string; outcome: "created" | "updated" | "unchanged" | "disabled"; rule_id: string }
  | { key: string; outcome: "refused" | "failed"; error_code: string; rule_id?: string };

export interface RulesSyncDeps {
  admin: SupabaseClient;
  graph: MetaGraph;
  now: () => Date;
}

interface MetaRule {
  id: string;
  name: string;
  status?: string;
  evaluation_spec?: unknown;
  execution_spec?: unknown;
  schedule_spec?: unknown;
}

const FIELDS = "id,name,status,evaluation_spec,execution_spec,schedule_spec";
const PAGES_MAX = 5;

export async function syncAutomatedRules(deps: RulesSyncDeps, input: RulesSyncInput): Promise<{ ok: boolean; results: RuleOutcome[] }> {
  const at = () => deps.now().toISOString();
  const started = await startAction(deps.admin, {
    org_id: input.orgId, campaign_id: null, connection_id: input.connectionId, kind: "rules_sync",
    actor_kind: "agent", actor_id: null, actor_name: "Ads rules sync (Meta)",
    request: { settings_version: input.settingsVersion, code: input.code },
  }, at());
  if (started === "duplicate" || "refusedBy" in started) throw new Error(`ads_actions: rules_sync could not start (${started === "duplicate" ? "duplicate" : started.refusedBy})`);

  const listed = await ourRules(deps.graph, input);
  if (!listed.ok) {
    await completeAction(deps.admin, input.orgId, started.id, { status: "failed", error_code: listed.error.error_code, at: at() });
    return { ok: false, results: [] };
  }
  const want = rulesSpec(input.settings.auto_pause, input.code);
  const byName = new Map<string, MetaRule[]>();
  for (const r of listed.data) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

  const results: RuleOutcome[] = [];
  for (const spec of want) results.push(await ensureRule(deps.graph, input.accountId, spec, byName.get(spec.name) ?? []));
  const wanted = new Set(want.map((s) => s.name));
  for (const [name, rows] of byName) {
    if (wanted.has(name)) continue;
    for (const r of rows.filter((x) => x.status !== "DISABLED")) {
      const off = await deps.graph.post(r.id, { status: "DISABLED" }, { idempotent: true });
      results.push(off.ok ? { key: keyOf(name), outcome: "disabled", rule_id: r.id } : { key: keyOf(name), outcome: "failed", error_code: off.error.error_code, rule_id: r.id });
    }
  }
  const failed = results.find((r) => r.outcome === "failed");
  await completeAction(deps.admin, input.orgId, started.id, {
    status: failed ? "failed" : "succeeded", error_code: failed && "error_code" in failed ? failed.error_code : null, response: { results }, at: at(),
  });
  return { ok: !failed, results };
}

async function ensureRule(graph: MetaGraph, accountId: string, spec: AdRuleSpec, found: MetaRule[]): Promise<RuleOutcome> {
  if (found.length > 1) return { key: spec.key, outcome: "failed", error_code: "duplicate_rule" };
  const body = { evaluation_spec: spec.evaluation_spec, execution_spec: spec.execution_spec, schedule_spec: spec.schedule_spec };
  const existing = found[0];
  if (existing) {
    const same = existing.status === "ENABLED" && stable(existing.evaluation_spec) === stable(body.evaluation_spec)
      && stable(existing.execution_spec) === stable(body.execution_spec) && stable(existing.schedule_spec) === stable(body.schedule_spec);
    if (same) return { key: spec.key, outcome: "unchanged", rule_id: existing.id };
    const r = await graph.post(existing.id, { ...body, status: "ENABLED" }, { idempotent: true });
    return r.ok ? { key: spec.key, outcome: "updated", rule_id: existing.id } : refusedOrFailed(spec.key, r.error.error_code, existing.id);
  }
  // A create is not idempotent at Meta; one whose answer was lost is found by name on the next run.
  const r = await graph.post<{ id: string }>(`act_${accountId}/adrules_library`, { name: spec.name, ...body }, { idempotent: false });
  return r.ok ? { key: spec.key, outcome: "created", rule_id: r.data.id } : refusedOrFailed(spec.key, r.error.error_code);
}

/** Meta's refusal of a rule's content (2703 and the like) is the U2 case; anything else is a failure. */
function refusedOrFailed(key: string, code: string, rule_id?: string): RuleOutcome {
  const content = code === "meta_2703";
  return { key, outcome: content ? "refused" : "failed", error_code: code, ...(rule_id ? { rule_id } : {}) };
}

async function ourRules(graph: MetaGraph, input: RulesSyncInput): Promise<GraphResult<MetaRule[]>> {
  const prefix = `${AD_RULE_PREFIX}${input.code}|`;
  const out: MetaRule[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGES_MAX; page++) {
    const r = await graph.get<{ data?: MetaRule[]; paging?: { next?: string; cursors?: { after?: string } } }>(`act_${input.accountId}/adrules_library`, { fields: FIELDS, limit: 100, after });
    if (!r.ok) return r;
    out.push(...(r.data.data ?? []).filter((x) => typeof x.name === "string" && x.name.startsWith(prefix)));
    after = r.data.paging?.next ? r.data.paging.cursors?.after : undefined;
    if (!after) return { ok: true, data: out, usage: r.usage, attempts: r.attempts };
  }
  return { ok: false, error: { kind: "invalid_request", error_code: "rule_list_too_long", http: null, code: null, subcode: null, fbtrace_id: null, message: `more than ${PAGES_MAX * 100} rules on the account`, retry_after_ms: null, outcome_unknown: false, attempts: 1 } };
}

const keyOf = (name: string): string => name.split("|").pop() ?? name;

/** JSON with sorted keys, so two equal specs compare equal whatever order Meta lists their keys in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
