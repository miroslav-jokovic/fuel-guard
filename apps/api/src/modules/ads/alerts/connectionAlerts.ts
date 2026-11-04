import type { SupabaseClient } from "@supabase/supabase-js";
import { markConnectionFailing } from "../connections/connections.js";
import type { CampaignRow } from "../orchestrator/transitions.js";
import { sendAdsAlert } from "./adsAlerts.js";

/**
 * A step failed because the connection itself cannot be used — the platform refused its token
 * (`token_invalid`) or there is none we can open (`no_platform`). Said once, for every act that meets it:
 * pausing (`pauseAlerts.ts`, audit H2) and creating paused (B2c2, §4R Publisher L2 "token revoked → stops +
 * alert"). The connection is marked `failing`, so Settings stops saying "connected" about a connection
 * nothing can use, and admins get `ads_token_expiring` once a day per connection.
 */
export const CONNECTION_CODES: ReadonlySet<string> = new Set(["token_invalid", "no_platform"]);

/** What a person was trying to do, in the alert's own words. */
export type ConnectionAct = "pause" | "create";
const ACT_WORDS: Record<ConnectionAct, string> = {
  pause: "Pausing an ad",
  create: "Putting a new campaign on the ad account",
};

/** True when the code is a connection fault and the connection was told about; false for any other code. */
export async function alertConnectionUnusable(admin: SupabaseClient, now: Date, c: Pick<CampaignRow, "org_id" | "connection_id">, code: string, act: ConnectionAct): Promise<boolean> {
  if (!CONNECTION_CODES.has(code)) return false;
  const marked = await markConnectionFailing(admin, c.org_id, c.connection_id, `${act}: ${code}`, now);
  await sendAdsAlert(admin, c.org_id, {
    category: "ads_token_expiring",
    title: "An ad account connection stopped working",
    body: `${ACT_WORDS[act]} failed because the connection cannot be used (${code}). Test or reconnect it on Settings › Ads control. Until then nothing here can pause or launch ads on it.`,
    severity: "critical",
    entityType: "ads_platform_connection",
    entityId: c.connection_id,
    dedupeKey: `ads_token_expiring:${c.connection_id}:${now.toISOString().slice(0, 10)}`,
  });
  return marked;
}
