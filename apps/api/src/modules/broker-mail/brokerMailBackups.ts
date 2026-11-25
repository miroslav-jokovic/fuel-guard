import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrokerMailTextState } from "@silvicom/shared";

/**
 * Each dispatcher's backups (0651, BROKER-MAIL-READER-PLAN P3; Q-BM10: only an admin chooses them, the
 * dispatcher sees them read-only) and whether a person can be texted at all. Every query filters
 * `org_id`: the service role bypasses RLS.
 */

export async function readBackups(admin: SupabaseClient, orgId: string): Promise<Map<string, string[]>> {
  const { data, error } = await admin.from("broker_mail_backups").select("dispatcher_user_id, backup_user_id").eq("org_id", orgId);
  if (error) throw new Error(`broker_mail_backups: ${error.message}`);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as { dispatcher_user_id: string; backup_user_id: string }[]) {
    out.set(r.dispatcher_user_id, [...(out.get(r.dispatcher_user_id) ?? []), r.backup_user_id]);
  }
  return out;
}

/**
 * Replace one dispatcher's list with exactly `next`. Delete then insert (the table has nothing else per
 * row to keep), both filtered to this org and this dispatcher. Returns the list before, for the audit.
 */
export async function replaceBackups(admin: SupabaseClient, orgId: string, dispatcherId: string, next: readonly string[], actorId: string): Promise<string[]> {
  const before = (await readBackups(admin, orgId)).get(dispatcherId) ?? [];
  const del = await admin.from("broker_mail_backups").delete().eq("org_id", orgId).eq("dispatcher_user_id", dispatcherId);
  if (del.error) throw new Error(`broker_mail_backups: ${del.error.message}`);
  if (next.length) {
    const ins = await admin.from("broker_mail_backups").insert(
      next.map((backup) => ({ org_id: orgId, dispatcher_user_id: dispatcherId, backup_user_id: backup, created_by: actorId })),
    );
    if (ins.error) throw new Error(`broker_mail_backups: ${ins.error.message}`);
  }
  return before;
}

/** Whether each of these people can be texted (`notification_contacts`, 0598): what the admin's list and the page say. */
export async function readTextStates(admin: SupabaseClient, orgId: string, userIds: readonly string[]): Promise<Map<string, BrokerMailTextState>> {
  const out = new Map<string, BrokerMailTextState>(userIds.map((u) => [u, "none"]));
  if (userIds.length === 0) return out;
  const { data, error } = await admin.from("notification_contacts").select("user_id, verified_at, stopped_at").eq("org_id", orgId).in("user_id", [...userIds]);
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  for (const c of (data ?? []) as { user_id: string; verified_at: string | null; stopped_at: string | null }[]) {
    out.set(c.user_id, c.stopped_at ? "stopped" : c.verified_at ? "ready" : "unconfirmed");
  }
  return out;
}
