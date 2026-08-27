import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stamp `integration_credentials.last_synced_at` for the org — org-owned (D-ARC3), so sync
 * handlers report "the integration ticked" through this interface instead of writing the table.
 * `org_id` is the table's primary key (0012): one row per org, so the whole-org update is exact,
 * not a shotgun.
 */
export async function stampIntegrationSynced(admin: SupabaseClient, orgId: string): Promise<void> {
  await admin
    .from("integration_credentials")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("org_id", orgId);
}
