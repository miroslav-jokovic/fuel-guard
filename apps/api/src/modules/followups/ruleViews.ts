/**
 * The rules as the desk and the "Follow-up rules" card read them (WARNING-DESK-PLAN D-WD10): the fixed
 * kinds plus one per live Samsara alert configuration, each with the admin's override applied. Every
 * default is `resolveFollowUpRules`'s — nothing here restates one.
 *
 * Samsara's configuration list is asked at most once per ten minutes per org and process. The list page
 * refreshes every minute and only needs the configurations' NAMES for its labels; a configuration added
 * in Samsara reaches the card within ten minutes, and the five-minute tick reads it fresh on its own.
 * When Samsara cannot be asked (no token, an outage) the fixed kinds still resolve, and the card says so.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  alertRuleKey,
  FIXED_RULES,
  resolveFollowUpRules,
  type AlertConfigurationSummary,
  type FollowUpRule,
  type FollowUpRuleView,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { readAlertConfigurations } from "../samsara/index.js";
import { readRuleOverrides } from "./rules.js";

const CONFIG_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; configs: AlertConfigurationSummary[] }>();

/** Tests only. */
export function clearConfigCache(): void {
  cache.clear();
}

export async function alertConfigurations(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  nowMs: number,
): Promise<{ configs: AlertConfigurationSummary[]; unavailable: boolean }> {
  const hit = cache.get(orgId);
  if (hit && nowMs - hit.at < CONFIG_TTL_MS) return { configs: hit.configs, unavailable: false };
  try {
    const configs = await readAlertConfigurations(admin, env, orgId);
    cache.set(orgId, { at: nowMs, configs });
    return { configs, unavailable: false };
  } catch (e) {
    console.warn(`[follow-ups] Samsara alert configurations unavailable for org ${orgId}:`, e instanceof Error ? e.message : e);
    // A stale list beats none: the names of yesterday's configurations are still their names.
    return { configs: hit?.configs ?? [], unavailable: true };
  }
}

export async function resolvedRules(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  nowMs: number,
): Promise<{ rules: FollowUpRule[]; configs: AlertConfigurationSummary[]; unavailable: boolean }> {
  const { configs, unavailable } = await alertConfigurations(admin, env, orgId, nowMs);
  return { rules: resolveFollowUpRules(configs, await readRuleOverrides(admin, orgId)), configs, unavailable };
}

/** A key the card may save: a fixed kind, or an alert configuration's (which Samsara may list later). */
export function isSavableRuleKey(key: string): boolean {
  return FIXED_RULES.some((r) => r.key === key) || /^alert:[A-Za-z0-9_-]{1,64}$/.test(key);
}

export async function ruleViews(admin: SupabaseClient, env: Env, orgId: string, nowMs: number): Promise<{ rules: FollowUpRuleView[]; samsaraUnavailable: boolean }> {
  const { configs, unavailable } = await alertConfigurations(admin, env, orgId, nowMs);
  const overrides = await readRuleOverrides(admin, orgId);
  const defaults = new Map(resolveFollowUpRules(configs, []).map((r) => [r.key, r]));
  const overridden = new Set(overrides.map((o) => o.ruleKey));
  const byKey = new Map(configs.map((c) => [alertRuleKey(c.id), c]));
  const settings = (r: FollowUpRule) => ({
    enabled: r.enabled,
    thresholdCount: r.thresholdCount,
    windowDays: r.windowDays,
    minActiveHours: r.minActiveHours,
    category: r.category,
    severity: r.severity,
  });
  const rules = resolveFollowUpRules(configs, overrides).map((r): FollowUpRuleView => {
    const c = byKey.get(r.key);
    return {
      key: r.key,
      label: r.label,
      source: r.source,
      subject: r.subject,
      ...settings(r),
      overridden: overridden.has(r.key),
      defaults: settings(defaults.get(r.key) ?? r),
      samsara: c ? { id: c.id, name: c.name, isEnabled: c.isEnabled } : null,
    };
  });
  return { rules, samsaraUnavailable: unavailable };
}
