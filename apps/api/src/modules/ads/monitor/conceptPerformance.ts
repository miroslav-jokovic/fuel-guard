import type { SupabaseClient } from "@supabase/supabase-js";
import { foldConcepts, type AdHourFact, type CampaignConcepts } from "@silvicom/shared";

/**
 * A campaign's concepts, as they did (ADS-CREATIVE-QUALITY-PLAN CQ3's reader; D-AD22): `ads_ad_spend_hourly`
 * (0577, written by `adInsightsPull.ts`) joined to the campaign's creatives and their presets, folded by
 * `foldConcepts` (shared, pure). The window is the last `CONCEPT_WINDOW_DAYS` of hours; the reconcile re-reads 28
 * days of insights (B5c), so a longer window would show hours nobody revises any more.
 *
 * Read with the service role, so every query here carries the org (CLAUDE.md: the API reads BYPASS RLS); the
 * campaign is read first, and a campaign of another carrier is "none", not an empty fold.
 */

export const CONCEPT_WINDOW_DAYS = 28;
const PAGE = 1000;

export async function campaignConcepts(admin: SupabaseClient, orgId: string, campaignId: string, now: Date): Promise<CampaignConcepts | null> {
  const { data: campaign, error } = await admin.from("ads_campaigns").select("id").eq("org_id", orgId).eq("id", campaignId).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!campaign) return null;

  const { data: cr, error: e2 } = await admin.from("ads_creatives").select("id, preset_version_id").eq("org_id", orgId).eq("campaign_id", campaignId).limit(PAGE);
  if (e2) throw new Error(`ads_creatives: ${e2.message}`);
  const creatives = (cr ?? []) as Array<{ id: string; preset_version_id: string }>;

  const versionIds = [...new Set(creatives.map((c) => c.preset_version_id))];
  const presets: Array<{ version_id: string; key: string }> = [];
  if (versionIds.length > 0) {
    const { data: vs, error: e3 } = await admin.from("ad_concept_preset_versions").select("id, preset_id").eq("org_id", orgId).in("id", versionIds);
    if (e3) throw new Error(`ad_concept_preset_versions: ${e3.message}`);
    const presetIds = [...new Set(((vs ?? []) as Array<{ preset_id: string }>).map((v) => v.preset_id))];
    const { data: ps, error: e4 } = await admin.from("ad_concept_presets").select("id, key").eq("org_id", orgId).in("id", presetIds);
    if (e4) throw new Error(`ad_concept_presets: ${e4.message}`);
    const keyOf = new Map(((ps ?? []) as Array<{ id: string; key: string }>).map((p) => [p.id, p.key]));
    for (const v of (vs ?? []) as Array<{ id: string; preset_id: string }>) {
      const key = keyOf.get(v.preset_id);
      if (key) presets.push({ version_id: v.id, key });
    }
  }

  const since = new Date(now.getTime() - CONCEPT_WINDOW_DAYS * 86_400_000);
  since.setUTCMinutes(0, 0, 0);
  const rows: AdHourFact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: e5 } = await admin
      .from("ads_ad_spend_hourly").select("creative_id, language, spend_cents, impressions, clicks, leads")
      .eq("org_id", orgId).eq("campaign_id", campaignId).gte("hour", since.toISOString())
      .order("meta_ad_id").order("hour").range(from, from + PAGE - 1);
    if (e5) throw new Error(`ads_ad_spend_hourly: ${e5.message}`);
    const got = (data ?? []) as Array<Record<string, unknown>>;
    // bigint columns arrive as strings or numbers depending on size; the fold adds numbers.
    for (const h of got) {
      rows.push({
        creative_id: String(h.creative_id), language: h.language as AdHourFact["language"],
        spend_cents: Number(h.spend_cents), impressions: Number(h.impressions), clicks: Number(h.clicks), leads: Number(h.leads),
      });
    }
    if (got.length < PAGE) break;
  }
  return { campaign_id: campaignId, since: since.toISOString(), read_at: now.toISOString(), concepts: foldConcepts(rows, creatives, presets) };
}
