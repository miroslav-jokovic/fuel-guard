import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is the carrier's TMS the master of this org's roster?
 *
 * The whole McLeod integration is opt-in per org — 0068 built `org_integrations` that way and it must
 * stay that way, because the answer to this question changes what the SAMSARA syncs are allowed to do.
 * An org that has never connected a TMS is bit-for-bit unaffected by everything in this module.
 *
 * Two conditions, both required: the integration is enabled, and the operator has explicitly declared
 * `config.roster_master`. Enabling the integration alone must NOT be enough — an org can reasonably
 * ingest movements and loads from McLeod while leaving Samsara in charge of who is on the roster, and
 * silently demoting their driver sync because they turned on load ingest would be a surprise nobody
 * asked for.
 *
 * Fails CLOSED, and the try/catch is part of that rather than defensive noise. Any error, missing row,
 * unreadable config — or a THROWN failure, which is how the first version got it wrong — leaves Samsara
 * in charge, the arrangement that has been running for a year. A sync that cannot tell which system
 * owns the roster must not be the one that decides to stop maintaining it: the failure mode of
 * guessing "TMS" here is a roster nobody updates, silently.
 */
export async function isTmsRosterMaster(admin: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("org_integrations")
      .select("enabled, config")
      .eq("org_id", orgId)
      .eq("provider", "mcleod")
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { enabled?: boolean | null; config?: Record<string, unknown> | null };
    if (row.enabled !== true) return false;
    return row.config?.roster_master === true;
  } catch {
    return false;
  }
}
