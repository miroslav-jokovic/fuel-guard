import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

/** Append an immutable audit record (audit H9). Best-effort: never throws into the request path. */
export async function writeAudit(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    org_id: entry.orgId,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entityId ?? null,
    meta: entry.meta ?? {},
  });
  if (error) {
    console.error(`[audit] failed to write '${entry.action}': ${error.message}`);
  }
}
