import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A person's decision on one creative (D-AD12; Track S's S1d door calls this). `ads_creatives` is written only
 * from `compose/` (`lint:table-writers`), so the door does not move a creative itself: it records the person's
 * act as an `ads_approvals` row (`approve_creative` / `reject_creative`, through `guard/approvals.ts`, that
 * table's writer) and hands its id here.
 *
 * ── THE STATE FOLLOWS A RECORDED ACT, NEVER STANDS ALONE ─────────────────────────────────────────
 * The move happens only when the approval row exists in this org, names THIS creative and campaign, is of the
 * kind the decision is, and has not been withdrawn. So "who approved this ad, and when" is always answered by
 * a row, and a creative never reads `approved` on the strength of a request alone. The publisher reads the
 * state (`platforms/meta/publishCampaign.ts`: approved creatives only), so this is the gate it trusts.
 *
 * ── ONE MOVE, COMPARE-AND-SET ────────────────────────────────────────────────────────────────────
 * `ready → approved` or `ready → rejected`, only while the campaign is in `review` — the state in which the
 * machine offers `creatives_approved`. The update is conditioned on `state = 'ready'`, so two people deciding
 * at once make one move; the loser reads the row back and gets `already` (the same decision) or `not_ready`
 * (the other one won). The same request twice is `already`, never an error a retrying screen must handle.
 * A rejected creative is what compose's Regenerate supersedes (`composeCampaign` REDO), so nothing here
 * deletes or edits content (0537's trigger freezes it once it leaves the workers).
 */

export type CreativeDecision = "approve" | "reject";
const KIND: Record<CreativeDecision, string> = { approve: "approve_creative", reject: "reject_creative" };
const TO: Record<CreativeDecision, "approved" | "rejected"> = { approve: "approved", reject: "rejected" };

export interface DecideCreativeAsk {
  campaignId: string;
  creativeId: string;
  decision: CreativeDecision;
  /** The `ads_approvals` row that records the person's decision. */
  approvalId: string;
  now: Date;
}

export type DecideCreativeRefusal =
  | "creative_not_found" | "campaign_not_in_review" | "not_ready"
  | "approval_not_found" | "approval_mismatch" | "approval_withdrawn";

export type DecideCreativeResult =
  | { ok: true; state: "approved" | "rejected"; moved: boolean }
  | { ok: false; refusal: DecideCreativeRefusal; state?: string };

export async function decideCreative(admin: SupabaseClient, orgId: string, ask: DecideCreativeAsk): Promise<DecideCreativeResult> {
  const to = TO[ask.decision];
  const { data: approval, error: aErr } = await admin.from("ads_approvals").select("id, kind, campaign_id, creative_id")
    .eq("org_id", orgId).eq("id", ask.approvalId).maybeSingle();
  if (aErr) throw new Error(`ads_approvals: ${aErr.message}`);
  if (!approval) return { ok: false, refusal: "approval_not_found" };
  const a = approval as { kind: string; campaign_id: string; creative_id: string | null };
  if (a.kind !== KIND[ask.decision] || a.campaign_id !== ask.campaignId || a.creative_id !== ask.creativeId) return { ok: false, refusal: "approval_mismatch" };

  const { data: withdrawn, error: wErr } = await admin.from("ads_approvals").select("id")
    .eq("org_id", orgId).eq("kind", "withdraw").eq("withdraws_id", ask.approvalId).limit(1);
  if (wErr) throw new Error(`ads_approvals: ${wErr.message}`);
  if ((withdrawn ?? []).length > 0) return { ok: false, refusal: "approval_withdrawn" };

  const creative = await readCreative(admin, orgId, ask);
  if (!creative) return { ok: false, refusal: "creative_not_found" };
  if (creative.state === to) return { ok: true, state: to, moved: false };
  // Any other state is refused by the update's own `state = 'ready'` condition below, read back as `not_ready`.

  const { data: campaign, error: cErr } = await admin.from("ads_campaigns").select("state").eq("org_id", orgId).eq("id", ask.campaignId).maybeSingle();
  if (cErr) throw new Error(`ads_campaigns: ${cErr.message}`);
  if ((campaign as { state?: string } | null)?.state !== "review") return { ok: false, refusal: "campaign_not_in_review" };

  const { data: moved, error: uErr } = await admin.from("ads_creatives")
    .update({ state: to, updated_at: ask.now.toISOString() })
    .eq("org_id", orgId).eq("campaign_id", ask.campaignId).eq("id", ask.creativeId).eq("state", "ready")
    .select("id");
  if (uErr) throw new Error(`ads_creatives: ${uErr.message}`);
  if ((moved ?? []).length === 1) return { ok: true, state: to, moved: true };

  // Someone else decided between our read and our write: their decision stands.
  const after = await readCreative(admin, orgId, ask);
  return after?.state === to ? { ok: true, state: to, moved: false } : { ok: false, refusal: "not_ready", state: after?.state };
}

async function readCreative(admin: SupabaseClient, orgId: string, ask: Pick<DecideCreativeAsk, "campaignId" | "creativeId">): Promise<{ state: string } | null> {
  const { data, error } = await admin.from("ads_creatives").select("state")
    .eq("org_id", orgId).eq("campaign_id", ask.campaignId).eq("id", ask.creativeId).maybeSingle();
  if (error) throw new Error(`ads_creatives: ${error.message}`);
  return data as { state: string } | null;
}
