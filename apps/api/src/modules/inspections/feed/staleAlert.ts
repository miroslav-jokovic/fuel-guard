import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDisplayDateTime, type RoadsideFeed } from "@silvicom/shared";
import { notify } from "../../messaging/index.js";
import { usersWhoManage } from "../../org/index.js";
import { readRoadsideFeed } from "./store.js";

/**
 * The alert that the org's FMCSA record has stopped refreshing (INSPECTION-CHALLENGE-PLAN §4.1, IC1c;
 * category `roadside_feed_stale`, 0470).
 *
 * ── WHY AN ALERT AND NOT ONLY THE LINE ON THE PAGE ──────────────────────────────────────────────
 * The card and the list already say "not refreshed since …" (`roadsideFeedState`, the same state
 * read here). But nobody opens a list to learn that it is stale: the people who would act on a
 * dead fetch are told once a day, until it recovers. `efs_feed_stale` (0154) was the same idea for
 * EFS and never got a sender, so a stopped EFS feed has been silent since — this one ships with its.
 *
 * ── WHO, AND HOW OFTEN ──────────────────────────────────────────────────────────────────────────
 * The safety section's MANAGERS (`usersWhoManage`, derived from the section matrix): a stale feed
 * asks somebody to do something — check Data & Sync, tell us — and a viewer cannot. One a day per
 * person and state: the dedupe key carries the UTC day, so a fetch that stays broken is a daily
 * reminder rather than an hourly one, and a change from "ours late" to "FMCSA late" is news.
 *
 * The scheduler calls this every tick, due or not; a run that just failed and one that never ran are
 * judged the same way. Never throws into the scheduler: an alert that cannot be sent is logged.
 */

/** Title and body for a late state; null when there is nothing to say. Pure. */
export function staleFeedNotice(feed: RoadsideFeed, timeZone?: string): { title: string; body: string } | null {
  const at = (iso: string | null) => formatDisplayDateTime(iso, "—", timeZone);
  switch (feed.state) {
    case "fresh":
      return null;
    case "ours_late":
      return {
        title: "FMCSA record not refreshed",
        body: `Our daily fetch from FMCSA has not succeeded since ${at(feed.fetchedAt)}. Roadside inspections and the Roadside card show the record as of then.`,
      };
    case "fmcsa_late":
      return {
        title: "FMCSA has stopped publishing",
        body: `FMCSA's inspection data has not been updated since ${at(feed.sourceUpdatedAt)}. Our fetch is working; new inspections will appear when FMCSA publishes again.`,
      };
    case "never":
      return {
        title: "FMCSA record not fetched yet",
        body: "Our fetch from FMCSA has never succeeded for this carrier, so Roadside inspections is empty. Check that the USDOT number in Settings is right.",
      };
  }
}

export async function alertIfFeedStale(admin: SupabaseClient, orgId: string, nowMs: number, timeZone?: string): Promise<number> {
  try {
    const feed = await readRoadsideFeed(admin, orgId, nowMs);
    const notice = staleFeedNotice(feed, timeZone);
    if (!notice) return 0;
    const day = new Date(nowMs).toISOString().slice(0, 10);
    let sent = 0;
    for (const userId of await usersWhoManage(admin, orgId, "safety")) {
      const id = await notify(admin, {
        orgId,
        userId,
        category: "roadside_feed_stale",
        severity: "warning",
        ...notice,
        dedupeKey: `roadside-feed-stale:${feed.state}:${day}`,
      });
      if (id) sent++;
    }
    return sent;
  } catch (e) {
    console.error(`[fmcsa-feed] org ${orgId}: stale-feed alert failed —`, e instanceof Error ? e.message : e);
    return 0;
  }
}
