import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which of a campaign's platform ads the monitor has retired (CQ9b), read from the act itself: the `retire_ad` rows
 * in `ads_actions` (0581), one per ad, keyed `retire_ad:<campaign>:<ad>`, with the ad's platform id in `request.ad`.
 *
 * ── WHY THE LEDGER, NOT `ads_creatives.platform_status` ──────────────────────────────────────────
 * A launch turns on every ad in `platform_refs.meta_ad_ids` (B3). Retiring pauses ONE ad and leaves the campaign
 * running, so a person's pause and relaunch turned the tired ad back on — found 2026-11-11 while building Q-AD68.
 * The fix must know which ads are retired, and two places record it. The creative's `platform_status = 'retired'` is
 * the coarser one: the publisher makes one ad PER LANGUAGE from one creative (the EN and ES ads share a creative id),
 * and the monitor judges and retires each ad on its own hours. Read at the creative, retiring the tired EN ad would
 * also keep its fresh ES sibling off at the next launch — a second bug in place of the first. The ledger row is per
 * ad, written by the act, append-only. Deriving from it adds no copy.
 *
 * ── WHICH ROWS COUNT ─────────────────────────────────────────────────────────────────────────────
 * `succeeded` (the platform confirmed the pause) and `started` (a crash between the call and its completion: the ad
 * may well be paused, and turning it on is the wrong direction to guess). A `failed` row is not retired: the platform
 * refused the pause, so the ad was never off, and leaving it out of a launch would change what is running without a
 * decision. Nothing un-retires an ad today; when something does, it is a new row kind this read must learn.
 */

const PAGE = 1000;

export async function retiredAdIds(admin: SupabaseClient, orgId: string, campaignId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("ads_actions").select("request, status")
    .eq("org_id", orgId).eq("campaign_id", campaignId).eq("kind", "retire_ad").in("status", ["started", "succeeded"])
    .limit(PAGE);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  const rows = (data ?? []) as Array<{ request: Record<string, unknown> | null }>;
  // A full page would silently drop retired ads, and a dropped one is turned back on: throw, never trust it.
  if (rows.length >= PAGE) throw new Error(`ads_actions: campaign ${campaignId} returned a full page of retire_ad rows`);
  const ids = rows.map((r) => r.request?.ad).filter((ad): ad is string => typeof ad === "string" && ad.length > 0);
  return [...new Set(ids)];
}
