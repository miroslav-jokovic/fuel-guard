import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AD_PLATFORMS, DEFAULT_ORG_TIMEZONE, conceptPair, dayRangeInstants, foldLeadCostReport,
  type AdAngleRef, type AdPresetRecipe, type AdsLeadCostView, type LeadSources,
} from "@silvicom/shared";
import { adRefsOf } from "../monitor/adInsightsPull.js";

/**
 * `GET /api/ads/report/leads?from=&to=` (ADS-PLATFORM-V2-PLAN V7d): cost per qualified lead and per hire, by source
 * and by angle, for the days asked. A read only. The fold and what each figure means are shared `leadCostReport.ts`;
 * this file is where each input comes from:
 *
 *   leads       recruiting's `LeadSources` (D-AD17: ads never reads recruiting's tables), every source, arrived in
 *               the window — handed in at the composition root;
 *   ad → angle  each campaign's publisher record (`platform_refs.ads[]`, `adRefsOf` — the map the hourly ad pull
 *               trusts), the creative's preset version, and that version's recipe's hook and scene (`conceptPair`);
 *   spend       the campaign hours (`ads_spend_hourly`) by the connection's platform, and the ad hours
 *               (`ads_ad_spend_hourly`) by the creative's angle, both inside the window.
 *
 * ── THE DAYS ──────────────────────────────────────────────────────────────────────────────────────
 * Inclusive calendar days in `DEFAULT_ORG_TIMEZONE`, the zone every other ads read reckons its days and months in
 * (`spendView.ts`, `monthContext`), so this report's November is the Overview's November. Half-open instants
 * (`dayRangeInstants`): an hour belongs to the window when it STARTS inside it, as the spend pages count it.
 *
 * Every query names the org: the service role bypasses RLS.
 */

const PAGE = 1000;
const CHUNK = 100;

type Rows<T> = T[];

async function paged<T>(label: string, build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Rows<T>> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const got = (data ?? []) as T[];
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

async function chunked<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

export async function adsLeadCostView(
  admin: SupabaseClient, sources: LeadSources, orgId: string, range: { from: string; to: string }, now: Date,
): Promise<AdsLeadCostView> {
  const zone = DEFAULT_ORG_TIMEZONE;
  const { start, endExclusive } = dayRangeInstants(range.from, range.to, zone);

  const { data: conns, error: cErr } = await admin.from("ads_platform_connections").select("id, provider").eq("org_id", orgId);
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const platformOf = new Map(((conns ?? []) as Array<{ id: string; provider: string }>)
    .filter((c) => (AD_PLATFORMS as readonly string[]).includes(c.provider)).map((c) => [c.id, c.provider]));

  const campaigns = await paged<{ id: string; connection_id: string; platform_refs: Record<string, unknown> | null }>("ads_campaigns", (a, b) =>
    admin.from("ads_campaigns").select("id, connection_id, platform_refs").eq("org_id", orgId).order("id").range(a, b));
  const providerOfCampaign = new Map(campaigns.map((c) => [c.id, platformOf.get(c.connection_id) ?? null]));
  const adRefs = campaigns.flatMap((c) => adRefsOf(c.platform_refs));

  const [leads, campaignHours, adHours] = await Promise.all([
    sources.everyLeadBetween(orgId, start, endExclusive),
    paged<{ campaign_id: string; spend_cents: number | string; currency: string }>("ads_spend_hourly", (a, b) =>
      admin.from("ads_spend_hourly").select("campaign_id, spend_cents, currency")
        .eq("org_id", orgId).gte("hour", start).lt("hour", endExclusive).order("campaign_id").order("hour").range(a, b)),
    paged<{ creative_id: string; spend_cents: number | string }>("ads_ad_spend_hourly", (a, b) =>
      admin.from("ads_ad_spend_hourly").select("creative_id, spend_cents")
        .eq("org_id", orgId).gte("hour", start).lt("hour", endExclusive).order("meta_ad_id").order("hour").range(a, b)),
  ]);

  // creative → preset version → recipe's concept, for every creative the record or the ad hours name (the record
  // only grows — `addCampaignAds` appends — but an hour is read by its own creative id all the same).
  const creativeIds = [...new Set([...adRefs.map((r) => r.creative_id), ...adHours.map((h) => h.creative_id)])];
  const creatives = await chunked(creativeIds, async (ids) => paged<{ id: string; preset_version_id: string }>("ads_creatives", (a, b) =>
    admin.from("ads_creatives").select("id, preset_version_id").eq("org_id", orgId).in("id", ids).order("id").range(a, b)));
  const versionIds = [...new Set(creatives.map((c) => c.preset_version_id))];
  const versions = await chunked(versionIds, async (ids) => paged<{ id: string; recipe: Pick<AdPresetRecipe, "hook_family" | "scene_family"> | null }>("ad_concept_preset_versions", (a, b) =>
    admin.from("ad_concept_preset_versions").select("id, recipe").eq("org_id", orgId).in("id", ids).order("id").range(a, b)));
  const conceptOfVersion = new Map(versions.map((v) => [v.id, v.recipe ? conceptPair(v.recipe) : null]));
  const angleOfCreative = new Map(creatives.map((c) => [c.id, conceptOfVersion.get(c.preset_version_id) ?? null]));
  const ads = new Map<string, AdAngleRef>(adRefs.map((r) => [r.meta_ad_id, { angle: angleOfCreative.get(r.creative_id) ?? null }]));

  const platformSpendCents = new Map<string, number>();
  const currencies = new Set<string>();
  for (const h of campaignHours) {
    const provider = providerOfCampaign.get(h.campaign_id);
    if (!provider) continue; // a campaign whose connection is gone or not an ad platform: no channel to put it under
    platformSpendCents.set(provider, (platformSpendCents.get(provider) ?? 0) + Number(h.spend_cents));
    currencies.add(h.currency);
  }
  // One currency or none: an account is set up in one, and summing two would be a number in no currency at all.
  if (currencies.size > 1) throw new Error(`ads_spend_hourly: more than one currency in the range (${[...currencies].sort().join(", ")})`);

  const angleSpendCents = new Map<string | null, number>();
  for (const h of adHours) {
    const angle = angleOfCreative.get(h.creative_id) ?? null;
    angleSpendCents.set(angle, (angleSpendCents.get(angle) ?? 0) + Number(h.spend_cents));
  }

  return {
    ...foldLeadCostReport({ leads, ads, platformSpendCents, angleSpendCents }),
    from: range.from, to: range.to, zone, currency: [...currencies][0] ?? null, checked_at: now.toISOString(),
  };
}
