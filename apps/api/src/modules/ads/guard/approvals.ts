import type { SupabaseClient } from "@supabase/supabase-js";
import { needsSecondApprover, type AdsSettings, type AdsSpendApproval } from "@silvicom/shared";
import type { Actor } from "../settings/settingsVersions.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * `ads_approvals` (0537, append-only): a person's yes to one spend act on one campaign (plan §5 — a
 * person launches every ad, raises every budget, widens every area). Written here; read here by the
 * budget guard, which will not call a platform's spend method without one.
 *
 * ── WHAT "A STANDING APPROVAL THAT COVERS THE ACT" MEANS ─────────────────────────────────────────
 *   · same org, campaign and kind;
 *   · not withdrawn (a withdrawal is a new row naming it, never an edit);
 *   · for the amounts: approved daily ≥ the act's daily and approved lifetime ≥ the act's lifetime, so
 *     a yes to $50/day cannot carry $80/day;
 *   · NOT ALREADY USED: cited by no `ads_actions` row that started or succeeded. One yes, one act. A
 *     campaign paused and launched again needs a new yes — otherwise one approval in March would
 *     relaunch the ad in June, which is not "a person launches every ad".
 * The database checks the first two again at insert (AX020); the amounts and single use are this
 * file's, because they are judgements about money, not facts about one row.
 *
 * ── A SECOND APPROVER (§4b) ──────────────────────────────────────────────────────────────────────
 * Above `second_approver_above_cents`, the act needs covering approvals from two DIFFERENT people.
 * Each is its own row; the action cites the newest. Nobody can be their own second approver.
 */

export interface StandingApproval {
  id: string;
  approved_by: string;
  approved_by_name: string;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  created_at: string;
}

export type ApprovalVerdict =
  | { ok: true; approval_id: string; approvers: string[] }
  | { ok: false; refusal: "no_standing_approval" | "second_approver_missing"; approvers: string[] };

export interface ApprovalAsk {
  campaignId: string;
  kind: "launch" | "raise_budget" | "change_area";
  /** Null for an area change, which moves no budget. */
  daily_cents: number | null;
  lifetime_cents: number | null;
}

export async function findCoveringApproval(admin: SupabaseClient, orgId: string, settings: AdsSettings, ask: ApprovalAsk): Promise<ApprovalVerdict> {
  const { data, error } = await admin
    .from("ads_approvals")
    .select("id, kind, withdraws_id, approved_by, approved_by_name, daily_budget_cents, lifetime_cap_cents, created_at")
    .eq("org_id", orgId)
    .eq("campaign_id", ask.campaignId)
    .in("kind", [ask.kind, "withdraw"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(`ads_approvals: ${error.message}`);
  const rows = (data ?? []) as Array<StandingApproval & { kind: string; withdraws_id: string | null }>;
  const withdrawn = new Set(rows.filter((r) => r.kind === "withdraw").map((r) => r.withdraws_id));
  const candidates = rows.filter((r) => r.kind === ask.kind && !withdrawn.has(r.id) && covers(r, ask));
  const used = await usedApprovalIds(admin, orgId, candidates.map((r) => r.id));
  const standing = candidates.filter((r) => !used.has(r.id));
  const approvers = [...new Set(standing.map((r) => r.approved_by))];
  if (standing.length === 0) return { ok: false, refusal: "no_standing_approval", approvers };
  if (ask.daily_cents !== null && needsSecondApprover(settings, ask.daily_cents) && approvers.length < 2) {
    return { ok: false, refusal: "second_approver_missing", approvers };
  }
  return { ok: true, approval_id: standing[0]!.id, approvers };
}

function covers(r: StandingApproval, ask: ApprovalAsk): boolean {
  if (ask.daily_cents === null) return true;
  return r.daily_budget_cents !== null && r.daily_budget_cents >= ask.daily_cents
    && (ask.lifetime_cents === null || (r.lifetime_cap_cents !== null && r.lifetime_cap_cents >= ask.lifetime_cents));
}

async function usedApprovalIds(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("ads_actions")
    .select("approval_id")
    .eq("org_id", orgId)
    .in("approval_id", ids)
    .in("status", ["started", "succeeded"]);
  if (error) throw new Error(`ads_actions approvals used: ${error.message}`);
  return new Set(((data ?? []) as Array<{ approval_id: string }>).map((r) => r.approval_id));
}

export type RecordApprovalResult =
  | { ok: true; id: string }
  | { ok: false; refusal: "campaign_not_found" | "settings_not_saved" | "nothing_to_withdraw" };

/** Writes one approval row (or one withdrawal). The route has already checked `ads.spend` and a fresh sign-in. */
export async function recordApproval(
  admin: SupabaseClient,
  orgId: string,
  approver: Actor,
  campaignId: string,
  body: AdsSpendApproval,
): Promise<RecordApprovalResult> {
  const { data: campaign, error } = await admin
    .from("ads_campaigns").select("id").eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!campaign) return { ok: false, refusal: "campaign_not_found" };
  // The caps in force when the person said yes (0537: NOT NULL). With nothing saved, no launch could
  // pass the guard anyway, and an approval naming no limits would be a yes to nothing in particular.
  const inForce = await settingsInForce(admin, orgId);
  if (inForce.version_id === null) return { ok: false, refusal: "settings_not_saved" };

  if (body.kind === "withdraw") {
    const { data: target, error: tErr } = await admin
      .from("ads_approvals").select("id, kind")
      .eq("org_id", orgId).eq("campaign_id", campaignId).eq("id", body.withdraws_id).maybeSingle();
    if (tErr) throw new Error(`ads_approvals: ${tErr.message}`);
    if (!target || (target as { kind: string }).kind === "withdraw") return { ok: false, refusal: "nothing_to_withdraw" };
  }

  const row = {
    org_id: orgId,
    campaign_id: campaignId,
    kind: body.kind,
    daily_budget_cents: "daily_budget_cents" in body ? body.daily_budget_cents : null,
    lifetime_cap_cents: "lifetime_cap_cents" in body ? body.lifetime_cap_cents : null,
    withdraws_id: body.kind === "withdraw" ? body.withdraws_id : null,
    settings_version_id: inForce.version_id,
    reason: body.reason ?? null,
    approved_by: approver.id,
    approved_by_name: approver.name,
  };
  const { data: ins, error: iErr } = await admin.from("ads_approvals").insert(row).select("id").single();
  if (iErr) throw new Error(`ads_approvals insert: ${iErr.message}`);
  return { ok: true, id: (ins as { id: string }).id };
}
