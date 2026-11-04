import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignRow } from "../orchestrator/transitions.js";
import { sendAdsAlert } from "./adsAlerts.js";
import { alertConnectionUnusable } from "./connectionAlerts.js";

/**
 * What a failed pause tells a person (2026-11-03 audit H2). The runner calls this after every
 * `pause_failed` move; it decides whether that is worth a bell.
 *
 * ⚠ STUCK = `STUCK_AFTER` FAILURES IN A ROW. One failed pause is usually a throttle the next tick clears,
 * and an alert per blip would teach people to ignore the one that matters. Three in a row is three
 * minutes of an ad we decided to stop still possibly delivering. The count is read from the campaign's
 * own transition rows, not from pause rows, because a step with no usable connection fails before it
 * can write a pause row (`no_platform`) — and a key this deploy cannot open is exactly that case.
 *
 * ⚠ ONE BELL PER CAMPAIGN PER HOUR while it stays stuck (`notify`'s dedupe on the hour's key): loud
 * enough that a stuck pause overnight is seen in the morning, not one per minute per recipient.
 *
 * A token the platform refuses (`token_invalid`) or none we can use (`no_platform`) also marks the
 * connection `failing` and sends `ads_token_expiring` once a day per connection
 * (`connectionAlerts.ts`, shared with the create step since B2c2).
 */
export const STUCK_AFTER = 3;

export interface PauseAlertResult {
  stuck: boolean;
  connection_marked: boolean;
}

export async function afterPauseFailed(admin: SupabaseClient, now: Date, c: CampaignRow, code: string): Promise<PauseAlertResult> {
  const result: PauseAlertResult = { stuck: false, connection_marked: false };
  const at = now.toISOString();
  const hour = at.slice(0, 13);

  result.connection_marked = await alertConnectionUnusable(admin, now, c, code, "pause");

  const { data, error } = await admin
    .from("ads_actions").select("request")
    .eq("org_id", c.org_id).eq("campaign_id", c.id).eq("kind", "transition").eq("status", "succeeded")
    .order("started_at", { ascending: false }).limit(STUCK_AFTER);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  const recent = (data ?? []) as Array<{ request: { event?: string } | null }>;
  result.stuck = recent.length === STUCK_AFTER && recent.every((r) => r.request?.event === "pause_failed");
  if (!result.stuck) return result;

  await sendAdsAlert(admin, c.org_id, {
    category: "ads_pause_failed",
    title: "An ad could not be paused",
    body: `We have tried to pause this ad ${STUCK_AFTER}+ times and the platform has not paused it (${code}). It may still be spending. Pause it now in the platform's own tool (Meta Ads Manager); we keep trying every minute.`,
    severity: "critical",
    entityType: "ads_campaign",
    entityId: c.id,
    dedupeKey: `ads_pause_failed:${c.id}:${hour}`,
  });
  return result;
}
