import type { SupabaseClient } from "@supabase/supabase-js";
import { completeAction, startAction } from "../actions/actionLedger.js";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { isNoSuchObject } from "./recordedGone.js";

/**
 * A Meta-rejected ad is detected (monitor-alerts, 2026-11-06; ADS-RUNBOOK Gap 3). Before this, the bell category
 * "Ads rejected by the platform" existed and nothing raised it, and nothing read Meta's verdict on an ad: a
 * rejected ad was found in Ads Manager or in Meta's email, not here.
 *
 * Reconcile's hourly pass reads each ad of every DELIVERING campaign of ours (`launching`, `live`):
 * `GET /{ad}?fields=id,effective_status,ad_review_feedback`. A verdict that needs a person — `DISAPPROVED` (it will
 * not run) or `WITH_ISSUES` (it runs with a problem) — is recorded ONCE as an `ads_actions` row of kind
 * `external_change` (actor `platform`: Meta decided, nobody here did), keyed on the ad and the status, and rings
 * `ads_rejected` once on the same key. The same verdict standing for a week is one row and one bell; the ad
 * coming back and being turned down again with the other status is a new one. The reasons are Meta's
 * `ad_review_feedback.global` descriptions. The field shapes are OUR reading of Meta's pages (cited in
 * `fakeMetaFaults.ts`, `ad_review`) until L4 reads a real verdict.
 *
 * Read-only, as all of reconcile is: nothing here writes to Meta or changes a campaign. A person decides — edit
 * the ad and regenerate, or appeal in Meta. An ad Meta no longer has is left to reconcile's campaign-level
 * `missing`; a read that fails is a failure of the run, so the job is not green while an ad went unread.
 */

export const REVIEW_STATUSES = ["DISAPPROVED", "WITH_ISSUES"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];
const DELIVERING = new Set(["launching", "live"]);
const AGENT_NAME = "Meta (ad review)";

export interface AdReviewTarget {
  campaign_id: string;
  state: string;
  ad_ids: string[];
}

export interface AdReviewResult {
  read: number;
  recorded: Array<{ ad_id: string; status: ReviewStatus }>;
  already_recorded: number;
  failures: Array<{ campaign_id: string; reason: string }>;
}

/** The ad ids a campaign's `platform_refs` hold (B2c1: `meta_ad_ids`, one per approved creative × language). */
export function adIdsOf(refs: Record<string, unknown> | null | undefined): string[] {
  const ids = refs?.meta_ad_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

export const adReviewKey = (connectionId: string, adId: string, status: string): string => `ad_review:${connectionId}:${adId}:${status}`;

function reasonsOf(feedback: unknown): string[] {
  const global = (feedback as { global?: unknown } | null)?.global;
  if (!global || typeof global !== "object") return [];
  return Object.values(global as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

export async function reviewAds(
  deps: { admin: SupabaseClient; now: () => Date }, graph: MetaGraph, orgId: string, connectionId: string, targets: readonly AdReviewTarget[],
): Promise<AdReviewResult> {
  const result: AdReviewResult = { read: 0, recorded: [], already_recorded: 0, failures: [] };
  for (const t of targets) {
    if (!DELIVERING.has(t.state)) continue;
    for (const adId of t.ad_ids) {
      const r = await graph.get<{ effective_status?: unknown; ad_review_feedback?: unknown }>(adId, { fields: "id,effective_status,ad_review_feedback" });
      if (!r.ok) {
        if (!isNoSuchObject(r.error)) result.failures.push({ campaign_id: t.campaign_id, reason: `ad_review:graph:${r.error.error_code}` });
        continue;
      }
      result.read += 1;
      const status = r.data.effective_status;
      if (!(REVIEW_STATUSES as readonly unknown[]).includes(status)) continue;
      const verdict = status as ReviewStatus;
      const reasons = reasonsOf(r.data.ad_review_feedback);
      const at = deps.now().toISOString();
      const row = await startAction(deps.admin, {
        org_id: orgId, campaign_id: t.campaign_id, connection_id: connectionId, kind: "external_change",
        actor_kind: "platform", actor_id: null, actor_name: AGENT_NAME,
        cause: `ad ${adId} ${verdict}${reasons.length ? `: ${reasons.join("; ")}` : ""}`.slice(0, 1000),
        idempotency_key: adReviewKey(connectionId, adId, verdict),
        request: { level: "ad", meta_id: adId, field: "review", theirs: verdict, reasons },
      }, at);
      if (row === "duplicate") {
        result.already_recorded += 1;
        continue;
      }
      if (!("id" in row)) throw new Error(`ads_actions: ad review refused by ${row.refusedBy}`);
      await completeAction(deps.admin, orgId, row.id, { status: "succeeded", at });
      result.recorded.push({ ad_id: adId, status: verdict });
      await sendAdsAlert(deps.admin, orgId, {
        category: "ads_rejected",
        title: verdict === "DISAPPROVED" ? "Meta turned down an ad" : "Meta found a problem with an ad",
        body: `${verdict === "DISAPPROVED" ? "Meta will not show this ad." : "Meta is showing this ad with a problem."}${reasons.length ? ` Meta's reason: ${reasons.join(" ")}` : " Meta gave no reason here; open the ad in Meta Ads Manager."} Edit the ad and regenerate it, or ask Meta to review it again.`.slice(0, 1000),
        severity: verdict === "DISAPPROVED" ? "critical" : "warning",
        entityType: "ads_campaign", entityId: t.campaign_id,
        dedupeKey: `ads_rejected:${connectionId}:${adId}:${verdict}`,
      });
    }
  }
  return result;
}
