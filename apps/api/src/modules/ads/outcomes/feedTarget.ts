import type { SupabaseClient } from "@supabase/supabase-js";
import { outcomeFeedOf } from "@silvicom/shared";
import type { ProcessEnv } from "../../../lib/deployEnvironment.js";
import { simulatorGate } from "../platforms/simulatorGate.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * Where a carrier's outcome feed sends, and whether it may send at all (B6; D-AD14 "disabled per org by a
 * switch"). The Conversions API writes to a DATASET (`POST /{dataset_id}/events`).
 *
 * ── RULED (Q-AD40, orchestrator 2026-11-06) ──────────────────────────────────────────────────────
 * (1) The switch and the dataset live in the versioned ads settings: `outcome_feed: { enabled, dataset_id }`,
 *     optional, an absent group being OFF (`outcomeFeedOf`, shared `settingsContract.ts`). So every version saved
 *     before the group existed still reads as off, and the feed starts only when an admin saves it on.
 * (2) A SIMULATOR connection may run the feed, against FakeMeta's own dataset (`SIMULATOR_DATASET_ID`), only
 *     where `simulatorGate` allows. On production its target is refused HERE, so nothing is even queued. The
 *     registry's own refusal (`graphForConnection`) is the second fence, if this one ever went.
 *
 * Settings that cannot be read are NOT taken as "off": that would turn a database fault into a feed that
 * silently stops. The read throws, and the run (or the tick's line) says so.
 */
export interface OutcomeFeedTarget {
  /** The Conversions API dataset (pixel) id the carrier's lead stages go to. */
  dataset_id: string;
  /** Events Manager's "Test events" code: sandbox certification only (the using-the-api page); never in production. */
  test_event_code?: string;
}

export interface OutcomeFeedTargets {
  /** The target of one connection, or null when the carrier's feed is off (the switch, D-AD14). */
  targetFor(orgId: string, connectionId: string): Promise<OutcomeFeedTarget | null>;
}

/** The targets from the settings version in force, per connection. */
export function settingsFeedTargets(admin: SupabaseClient, processEnv: ProcessEnv = process.env): OutcomeFeedTargets {
  return {
    async targetFor(orgId, connectionId) {
      const feed = outcomeFeedOf((await settingsInForce(admin, orgId)).settings);
      if (!feed.enabled || !feed.dataset_id) return null;
      const { data, error } = await admin.from("ads_platform_connections").select("provider")
        .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
      if (error) throw new Error(`ads_platform_connections: ${error.message}`);
      const provider = (data as { provider?: string } | null)?.provider;
      if (provider === "meta") return { dataset_id: feed.dataset_id };
      if (provider === "simulator" && simulatorGate(processEnv).allowed) return { dataset_id: feed.dataset_id };
      return null;
    },
  };
}
