import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

/** Append an immutable audit record. Retry once, then return false with a structured error log so callers
 * can choose their failure policy without mistaking an audit outage for a successful write. */
export async function writeAudit(admin: SupabaseClient, entry: AuditEntry): Promise<boolean> {
  const payload = {
    org_id: entry.orgId,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entityId ?? null,
    meta: entry.meta ?? {},
  };
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await admin.from("audit_logs").insert(payload);
    if (!error) return true;
    lastError = error.message;
  }
  console.error(`[audit] write failed after retry`, { action: entry.action, orgId: entry.orgId, error: lastError });
  return false;
}
