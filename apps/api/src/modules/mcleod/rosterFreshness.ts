import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterFreshness } from "@silvicom/shared";
import { ROSTER_PROVIDER } from "./tmsIngest.js";

/**
 * Reads the roster's freshness row. The row is WRITTEN by `stampRosterRead` in `tmsIngest.ts`,
 * beside the financial sweep's identical stamp, because that file is the McLeod module's one writer
 * of `org_integrations` (`scripts/table-writers.json`); see it for why the row exists at all.
 */
export async function readRosterFreshness(admin: SupabaseClient, orgId: string): Promise<RosterFreshness> {
  const [{ data: stamp }, { data: mcleod }] = await Promise.all([
    admin
      .from("org_integrations")
      .select("last_synced_at, config")
      .eq("org_id", orgId)
      .eq("provider", ROSTER_PROVIDER)
      .maybeSingle(),
    admin.from("org_integrations").select("enabled").eq("org_id", orgId).eq("provider", "mcleod").maybeSingle(),
  ]);
  const row = stamp as { last_synced_at?: string | null; config?: { counts?: RosterFreshness["counts"] } | null } | null;
  return {
    // A carrier with a McLeod integration has a roster to be fresh or stale about, even before the
    // first read — that is the "never" state, and it must show rather than hide.
    configured: row !== null || (mcleod as { enabled?: boolean } | null)?.enabled === true,
    readAt: row?.last_synced_at ?? null,
    counts: row?.config?.counts ?? null,
  };
}
