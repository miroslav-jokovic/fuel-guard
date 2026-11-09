import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_QUALITY_WINDOW_DAYS, leadQualityBreaches, leadQualityOf, recordId, type LeadQuality, type LeadQualityBreach } from "@silvicom/shared";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * The lead-quality alert (ADS-LEAD-QUALITY-PLAN LQ3b; Q-AD51 ruled (a) 2026-11-09: an ALERT, never a pause, for
 * the first weeks). Runs once a day in the org's `ads_daily_brief` job, before the brief: it needs recruiting's
 * call outcomes (`LeadQuality`, injected — D-AD17), which a person records over hours, not Meta's hourly numbers,
 * so the hourly monitor is the wrong clock for it.
 *
 * ── ONCE PER CAMPAIGN PER RULE ───────────────────────────────────────────────────────────────────
 * The dedupe key is `ads_lead_quality:<campaign>:<rule>`, so a campaign that stays bad is not rung every
 * morning: the first alert says what to look at, and the campaign drawer and the brief carry the figures after.
 * The window (`LEAD_QUALITY_WINDOW_DAYS`) is arrivals, so an old campaign's early leads stop counting.
 *
 * ── WHAT IT NEVER DOES ───────────────────────────────────────────────────────────────────────────
 * It moves no campaign and spends nothing: no `applyCampaignEvent`, no platform call (Q-AD51 (a)). A campaign
 * the alert names is one a person decides about.
 */
export interface LeadQualityDeps {
  admin: SupabaseClient;
  now: () => Date;
  leadQuality: LeadQuality;
}

export interface LeadQualityResult {
  breaches: LeadQualityBreach[];
  rung: number;
}

export const leadQualityDedupeKey = (campaignId: string, rule: LeadQualityBreach["rule"]): string => `ads_lead_quality:${campaignId}:${rule}`;

function words(b: LeadQualityBreach, name: string): { title: string; body: string } {
  if (b.rule === "wrong_numbers") {
    return {
      title: "An ad's leads are mostly wrong numbers",
      body: `${name}: ${b.part} of the ${b.whole} leads the team has called were wrong numbers (${b.measured_pct}%, at or past the ${b.threshold_pct}% set on Settings › Ads control). The campaign keeps running; look at its form and audience before spending more.`,
    };
  }
  return {
    title: "An ad's leads mostly do not qualify",
    body: `${name}: ${b.part} of its ${b.whole} recent leads said something that plainly misses a hard requirement, such as no Class A (${b.measured_pct}%, at or past the ${b.threshold_pct}% set on Settings › Ads control). The campaign keeps running; look at its words and area before spending more.`,
  };
}

export async function checkLeadQuality(deps: LeadQualityDeps, orgId: string): Promise<LeadQualityResult> {
  const { settings } = await settingsInForce(deps.admin, orgId);
  const thresholds = leadQualityOf(settings);
  if (!thresholds.enabled) return { breaches: [], rung: 0 };
  const since = new Date(deps.now().getTime() - LEAD_QUALITY_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await deps.leadQuality.qualitySince(orgId, since);
  // A lead's `campaign_ref` is free text (0553: "as the platform named it"); an ads lead's is our campaign's id
  // (backfill.ts, leadFetch.ts). Only uuid-shaped refs are asked of `ads_campaigns.id` — any other text in an
  // `.in()` on a uuid column is a 22P02 that would fail the whole job — and only this org's campaigns ring.
  const ids = [...new Set(rows.map((r) => r.campaign_id))].filter((id) => recordId().safeParse(id).success);
  if (ids.length === 0) return { breaches: [], rung: 0 };
  const { data, error } = await deps.admin.from("ads_campaigns").select("id, name").eq("org_id", orgId).in("id", ids);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const names = new Map(((data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const breaches = leadQualityBreaches(rows.filter((r) => names.has(r.campaign_id)), thresholds);
  let rung = 0;
  for (const b of breaches) {
    rung += await sendAdsAlert(deps.admin, orgId, {
      category: "ads_lead_quality", severity: "warning", ...words(b, names.get(b.campaign_id)!),
      entityType: "ads_campaigns", entityId: b.campaign_id, dedupeKey: leadQualityDedupeKey(b.campaign_id, b.rule),
    });
  }
  return { breaches, rung };
}
