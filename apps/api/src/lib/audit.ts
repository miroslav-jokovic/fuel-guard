import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

/**
 * `audit_logs.entity_id` is `uuid` (migration 0003) and `AuditEntry.entityId` is `string`. Two
 * sources of truth for one field, and Postgres is the one that finds out.
 *
 * FOUND THE HARD WAY (Step 5.11, 2026-08-15). The first real capability promotion succeeded and
 * wrote NO audit row: the promote route passed the capability KEY — "card_lock" — the insert failed
 * on the uuid cast, `writeAudit` retried once, logged to stderr, returned false, and the caller
 * ignored the return. The response said ok: true. A promotion is the act that lets code touch a
 * customer's fuel cards, and it was unattributable.
 *
 * The sweep of all 109 call sites (Step 5.11) found four more already doing it — a feature slug, two
 * composite `${driverId}:${featureKey}` keys and a comma-joined id list — each losing its whole audit
 * row, silently, every time it ran.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuditEntityId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Append an immutable audit record. Retry once, then return false with a structured error log so
 * callers can choose their failure policy without mistaking an audit outage for a successful write.
 *
 * A non-uuid `entityId` does NOT fail the write and does not throw. Losing the row is the actual
 * disaster this step exists to stop, and a throw would only move the loss from the audit table to
 * the caller's request. Instead the value is moved into `meta.entityIdRejected`, `entity_id` is left
 * null, and the mismatch is logged — so the record still lands, still names its actor, action and
 * org, and still carries the identifier, in a column that can hold it. `auditEntityId.test.ts` fails
 * the build on a call site that can be shown statically to pass a non-uuid.
 */
export async function writeAudit(admin: SupabaseClient, entry: AuditEntry): Promise<boolean> {
  const rejected = entry.entityId !== undefined && entry.entityId !== null && !isAuditEntityId(entry.entityId);
  if (rejected) {
    console.error(`[audit] entityId is not a uuid — recording it in meta instead of losing the row`, {
      action: entry.action,
      orgId: entry.orgId,
      entity: entry.entity ?? null,
      entityId: entry.entityId,
    });
  }

  const payload = {
    org_id: entry.orgId,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: rejected ? null : (entry.entityId ?? null),
    meta: rejected ? { ...(entry.meta ?? {}), entityIdRejected: entry.entityId } : (entry.meta ?? {}),
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
