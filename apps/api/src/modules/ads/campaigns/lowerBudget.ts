import type { SupabaseClient } from "@supabase/supabase-js";
import { mayAct, type AdsLowerBudget, type AdsLowerBudgetRefusal } from "@silvicom/shared";
import { completeAction, startAction } from "../actions/actionLedger.js";
import { lowerCampaignBudget } from "../orchestrator/transitions.js";
import { adapterForConnection, type RegistryDeps } from "../platforms/registry.js";
import type { Actor } from "../settings/settingsVersions.js";

/**
 * A person lowers a delivering campaign's daily budget (V5 part 2; Q-APX21 (a), ruled 2026-11-19;
 * `ADS_AUTHORITY.lower_budget`). Until then Level A said "lower a budget — ruled and built" and nothing could.
 *
 * ── THE SAFE DIRECTION, CHECKED THREE TIMES ───────────────────────────────────────────────────────
 * Less can only be spent, so this asks no approval and no fresh sign-in, as a pause asks none. "Lower" is held (1) by
 * this door against our row, (2) by the adapter against what Meta holds at the moment of the call (`not_lower`) — a
 * person editing in Ads Manager can have made our row stale — and (3) by Meta's own read-back.
 *
 * ── THE LEDGER FIRST, OUR ROW LAST ────────────────────────────────────────────────────────────────
 * A `lower_budget` row (no database fence: 0537 fences launch and raise only) is started before Meta is asked and
 * completed with Meta's answer, so a lower that reached Meta is on record whatever happens after. Only then is the
 * campaign's `daily_budget_cents` moved (by its owner, `transitions.ts` `lowerCampaignBudget`), by compare-and-set on the amount and state it was read at: the daily
 * reconcile compares Meta's ad set with that column, and a lower left out of it would read as someone else's change.
 * If the row moved meanwhile (a pause, another lower), Meta holds the lowered amount and the ledger says so; the
 * reconcile reports the gap rather than this door guessing which is right.
 */

export type LowerBudgetOutcome =
  | { kind: "lowered"; from_cents: number; to_cents: number; recorded: boolean }
  | { kind: "refused"; refusal: AdsLowerBudgetRefusal; detail?: string }
  | { kind: "not_found" };

export async function lowerBudget(
  deps: RegistryDeps & { admin: SupabaseClient }, orgId: string, actor: Actor, campaignId: string, ask: AdsLowerBudget, now: Date,
): Promise<LowerBudgetOutcome> {
  const { admin } = deps;
  if (!mayAct("lower_budget", "person")) return { kind: "refused", refusal: "not_permitted" };
  const { data, error } = await admin.from("ads_campaigns").select("id, state, connection_id, daily_budget_cents, platform_refs")
    .eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!data) return { kind: "not_found" };
  const c = data as { id: string; state: string; connection_id: string; daily_budget_cents: number | string | null; platform_refs: Record<string, unknown> | null };
  if (c.state !== "live") return { kind: "refused", refusal: "not_live" };
  if (c.daily_budget_cents === null) return { kind: "refused", refusal: "no_budget" };
  const from = Number(c.daily_budget_cents);
  if (!(ask.daily_budget_cents < from)) return { kind: "refused", refusal: "not_lower", detail: `the daily budget is ${from} cents` };

  const found = await adapterForConnection(deps, orgId, c.connection_id);
  if (!found) return { kind: "refused", refusal: "no_platform" };

  const at = now.toISOString();
  const key = `lower_budget:${c.id}:${from}:${ask.daily_budget_cents}`;
  const started = await startAction(admin, {
    org_id: orgId, campaign_id: c.id, creative_id: null, connection_id: c.connection_id, kind: "lower_budget",
    actor_kind: "person", actor_id: actor.id, actor_name: actor.name, cause: ask.reason, idempotency_key: key,
    request: { from_cents: from, to_cents: ask.daily_budget_cents },
  }, at);
  // The same lower pressed twice: the first is the one on record; nothing is asked of Meta again.
  if (started === "duplicate") return { kind: "lowered", from_cents: from, to_cents: ask.daily_budget_cents, recorded: false };
  if (!("id" in started)) return { kind: "refused", refusal: "platform_refused", detail: started.refusedBy };

  const out = await found.adapter.safe.lowerDailyBudget({
    campaign: { campaign_id: c.id, platform: found.platform, platform_refs: c.platform_refs ?? {} }, daily_budget_cents: ask.daily_budget_cents, idempotency_key: key,
  });
  await completeAction(admin, orgId, started.id, { status: out.ok ? "succeeded" : "failed", response: out.response ?? null, error_code: out.ok ? null : out.error_code, at: now.toISOString() });
  if (!out.ok) return { kind: "refused", refusal: out.error_code === "not_lower" ? "not_lower" : "platform_refused", detail: out.error_code };

  const recorded = await lowerCampaignBudget(admin, { org_id: orgId, id: c.id }, from, ask.daily_budget_cents);
  return { kind: "lowered", from_cents: from, to_cents: ask.daily_budget_cents, recorded };
}
