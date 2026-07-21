import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformAdmin } from "./platformAdmins.js";

export interface AuditEntry {
  action: string; // e.g. 'org.suspend', 'billing.comp', 'impersonation.start'
  targetOrgId?: string | null;
  targetEntity?: string | null;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append one immutable row to platform_audit_log. EVERY cross-tenant action funnels through here; the
 * table blocks update/delete at the DB level, so this is a write-once accountability record.
 */
export async function writePlatformAudit(
  admin: SupabaseClient,
  actor: PlatformAdmin,
  e: AuditEntry,
): Promise<void> {
  await admin.from("platform_audit_log").insert({
    admin_id: actor.id,
    admin_email: actor.email,
    action: e.action,
    target_org_id: e.targetOrgId ?? null,
    target_entity: e.targetEntity ?? null,
    target_id: e.targetId ?? null,
    reason: e.reason ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: e.ip ?? null,
    user_agent: e.userAgent ?? null,
  });
}
