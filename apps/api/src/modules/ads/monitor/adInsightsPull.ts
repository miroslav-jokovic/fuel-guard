import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The AD half of the hourly insights pull (ADS-CREATIVE-QUALITY-PLAN CQ3, D-AD22; migration 0577): the same
 * hours `insightsPull.ts` stores per campaign, stored per AD in `ads_ad_spend_hourly`, each row naming the
 * creative and language the publisher recorded for that ad. The campaign-level row answers "what did this
 * campaign spend"; these answer "which CONCEPT brought the leads" — the figure plan §8, D-AD11's reweighting and
 * §2b's fatigue rule all named and nothing stored (G-CQ3).
 *
 * ── THE PULL ASKS THE SAME EDGE WITH `level=ad` ──────────────────────────────────────────────────
 * `insightsPull.ts` reads `{campaign}/insights?level=ad` for the same window right after its campaign read
 * (the Insights API: "Querying a parent with a lower level … returns one row per child", read 2026-11-09),
 * turns each row into the campaign-shaped `SpendRow` with its `ad_id`, and hands them here. This file knows the
 * map from Meta's ad id to our creative — `ads_campaigns.platform_refs.ads[]`, written by the publisher (B2c)
 * — and refuses a row for an ad that map does not hold (`unknown_ad:<id>`): an ad somebody made in Ads Manager
 * is recorded as a failure for the reconcile's `external_change`, never adopted into a creative's figures.
 *
 * ── REPLACE, AND ZERO WHAT META STOPPED REPORTING ────────────────────────────────────────────────
 * A full-row upsert on (meta_ad_id, hour): a revised hour is replaced, and `lint:upserts`' NOT NULL rule has
 * nothing to refuse. When the ad-level read was complete, an (ad, hour) we hold non-zero that Meta no longer
 * reports is written as zero, as the campaign table does (B5a) — a partial read (truncated, a row of the wrong
 * shape) zeroes nothing, so a flaky page never erases a true hour.
 */

export const AD_LANGUAGES = ["en", "es"] as const;
export type AdLanguage = (typeof AD_LANGUAGES)[number];

/** One published ad as `platform_refs.ads[]` records it (publisherAds.ts `PublishedAd`). */
export interface AdRef { creative_id: string; language: AdLanguage; meta_ad_id: string }

/** The ads a campaign's refs name; a malformed entry is left out rather than guessed at. */
export function adRefsOf(platformRefs: Record<string, unknown> | null | undefined): AdRef[] {
  const ads = platformRefs?.ads;
  if (!Array.isArray(ads)) return [];
  const out: AdRef[] = [];
  for (const a of ads as Array<Record<string, unknown>>) {
    const creative = a?.creative_id, lang = a?.language, ad = a?.meta_ad_id;
    if (typeof creative === "string" && creative && (AD_LANGUAGES as readonly unknown[]).includes(lang) && typeof ad === "string" && /^[0-9]{1,40}$/.test(ad)) {
      out.push({ creative_id: creative, language: lang as AdLanguage, meta_ad_id: ad });
    }
  }
  return out;
}

export interface CampaignHour {
  org_id: string;
  campaign_id: string;
  hour: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  currency: string;
  pulled_at: string;
}

export interface AdSpendRow extends CampaignHour {
  creative_id: string;
  language: AdLanguage;
  meta_ad_id: string;
}

/** A campaign-shaped hour with its Meta ad id → the ad row, or why not. Pure. */
export function adSpendRow(base: CampaignHour, adId: unknown, refs: readonly AdRef[]): AdSpendRow | { reason: string } {
  if (typeof adId !== "string" || !/^[0-9]{1,40}$/.test(adId)) return { reason: "shape" };
  const ref = refs.find((r) => r.meta_ad_id === adId);
  if (!ref) return { reason: `unknown_ad:${adId}` };
  return { ...base, creative_id: ref.creative_id, language: ref.language, meta_ad_id: adId };
}

const WRITE_CHUNK = 500;
const adKey = (adId: string, hour: string) => `${adId}|${hour}`;

export interface AdWriteOutcome { written: number; zeroed: number }

/**
 * Store this campaign's fresh ad hours; when `whole`, zero every held (ad, hour) in the window Meta no longer
 * reports. `from`/`to` are the window's UTC bounds, as the campaign pull computes them.
 */
export async function writeAdHours(admin: SupabaseClient, c: { org_id: string; campaign_id: string }, fresh: readonly AdSpendRow[], win: { from: string; to: string; whole: boolean; pulled_at: string }): Promise<AdWriteOutcome> {
  const have = new Set(fresh.map((r) => adKey(r.meta_ad_id, r.hour)));
  const zeroed: AdSpendRow[] = [];
  if (win.whole) {
    const { data: held, error } = await admin
      .from("ads_ad_spend_hourly").select("creative_id, language, meta_ad_id, hour, currency, spend_cents, impressions, clicks, leads")
      .eq("org_id", c.org_id).eq("campaign_id", c.campaign_id).gte("hour", win.from).lt("hour", win.to).limit(1000);
    if (error) throw new Error(`ads_ad_spend_hourly: ${error.message}`);
    for (const h of (held ?? []) as Array<{ creative_id: string; language: AdLanguage; meta_ad_id: string; hour: string; currency: string; spend_cents: number; impressions: number; clicks: number; leads: number }>) {
      const at = new Date(h.hour).toISOString();
      const nonZero = Number(h.spend_cents) > 0 || Number(h.impressions) > 0 || Number(h.clicks) > 0 || Number(h.leads) > 0;
      if (!have.has(adKey(h.meta_ad_id, at)) && nonZero) {
        zeroed.push({
          org_id: c.org_id, campaign_id: c.campaign_id, creative_id: h.creative_id, language: h.language, meta_ad_id: h.meta_ad_id, hour: at,
          spend_cents: 0, impressions: 0, clicks: 0, leads: 0, currency: h.currency, pulled_at: win.pulled_at,
        });
      }
    }
  }
  const rows = [...fresh, ...zeroed];
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    // Every column, so an existing (ad, hour) is REPLACED — a revision down included (lint:upserts).
    const { error } = await admin.from("ads_ad_spend_hourly").upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "meta_ad_id,hour" });
    if (error) throw new Error(`ads_ad_spend_hourly: ${error.message}`);
  }
  return { written: fresh.length, zeroed: zeroed.length };
}
