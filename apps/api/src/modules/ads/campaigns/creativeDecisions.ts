import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdsCreativeDecision } from "@silvicom/shared";
import { campaignAcceptsDecision, decideCreative, type DecideCreativeRefusal } from "../compose/decideCreative.js";
import { recordApproval } from "../guard/approvals.js";
import type { Actor } from "../settings/settingsVersions.js";

/**
 * A person approves or rejects one creative (Track S, S1d; D-AD12). Three owners, each doing its own part:
 *   1. this door checks the obvious first — the campaign is in `review`, the creative is `ready` — so a press
 *      that cannot apply leaves no row behind;
 *   2. `guard/approvals.ts` (`ads_approvals`' writer) records the decision, naming the creative (0537);
 *   3. `compose/decideCreative.ts` (Track W's; `ads_creatives`' writer) moves the creative on that row's id,
 *      compare-and-set.
 * If step 3 still does not move it — two people pressed at once and the other decision landed — the row this
 * door wrote is WITHDRAWN (a new row naming it, never an edit: the table is append-only), so the ledger never
 * shows a decision that did not apply. The same decision pressed twice is `already` and writes nothing new.
 */
export type DecisionOutcome =
  | { kind: "decided"; state: "approved" | "rejected"; moved: boolean }
  | { kind: "not_found" }
  | { kind: "refused"; reason: DecideCreativeRefusal | "settings_not_saved" };

export async function decideOnCreative(
  admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, creativeId: string, ask: AdsCreativeDecision, now: Date,
): Promise<DecisionOutcome> {
  const to = ask.decision === "approve" ? "approved" : "rejected";
  const [{ data: campaign, error: cErr }, { data: creative, error: crErr }] = await Promise.all([
    admin.from("ads_campaigns").select("state").eq("org_id", orgId).eq("id", campaignId).maybeSingle(),
    admin.from("ads_creatives").select("state").eq("org_id", orgId).eq("campaign_id", campaignId).eq("id", creativeId).maybeSingle(),
  ]);
  if (cErr) throw new Error(`ads_campaigns: ${cErr.message}`);
  if (crErr) throw new Error(`ads_creatives: ${crErr.message}`);
  if (!campaign || !creative) return { kind: "not_found" };
  const state = (creative as { state: string }).state;
  if (state === to) return { kind: "decided", state: to, moved: false };
  // `review`, or a retired ad's replacement on a live campaign (Q-AD68) — the one rule `decideCreative` also asks.
  if (!(await campaignAcceptsDecision(admin, orgId, campaignId, creativeId, (campaign as { state: string }).state))) return { kind: "refused", reason: "campaign_not_in_review" };
  if (state !== "ready") return { kind: "refused", reason: "not_ready" };

  const kind = ask.decision === "approve" ? "approve_creative" : "reject_creative";
  const recorded = await recordApproval(admin, orgId, actor, campaignId, { kind, creative_id: creativeId, reason: ask.reason ?? null });
  if (!recorded.ok) return recorded.refusal === "settings_not_saved" ? { kind: "refused", reason: "settings_not_saved" } : { kind: "not_found" };

  const out = await decideCreative(admin, orgId, { campaignId, creativeId, decision: ask.decision, approvalId: recorded.id, now });
  if (out.ok && out.moved) return { kind: "decided", state: out.state, moved: true };
  await recordApproval(admin, orgId, actor, campaignId, {
    kind: "withdraw", withdraws_id: recorded.id, reason: `did not apply: ${out.ok ? `already ${out.state}` : out.refusal}`,
  });
  return out.ok ? { kind: "decided", state: out.state, moved: false } : { kind: "refused", reason: out.refusal };
}

/** At least one creative of this campaign a person approved — what `creatives_approved` claims. */
export async function hasApprovedCreative(admin: SupabaseClient, orgId: string, campaignId: string): Promise<boolean> {
  const { data, error } = await admin.from("ads_creatives").select("id").eq("org_id", orgId).eq("campaign_id", campaignId).eq("state", "approved").limit(1);
  if (error) throw new Error(`ads_creatives: ${error.message}`);
  return (data ?? []).length > 0;
}
