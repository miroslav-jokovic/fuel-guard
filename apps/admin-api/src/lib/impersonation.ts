import type { SupabaseClient } from "@supabase/supabase-js";

/** How long a read-only support grant lasts before it auto-expires. */
export const GRANT_MINUTES = 60;

export interface Grant {
  id: string;
  orgId: string;
  adminId: string;
  scope: "read_only" | "read_write";
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface GrantRow {
  id: string;
  org_id: string;
  admin_id: string;
  scope: "read_only" | "read_write";
  reason: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

const toGrant = (r: GrantRow): Grant => ({
  id: r.id,
  orgId: r.org_id,
  adminId: r.admin_id,
  scope: r.scope,
  reason: r.reason,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

const GRANT_COLS = "id, org_id, admin_id, scope, reason, created_at, expires_at, revoked_at";

/** Open a time-boxed READ-ONLY grant for this admin over one org. Reason is required by the caller. */
export async function startGrant(
  admin: SupabaseClient,
  adminId: string,
  orgId: string,
  reason: string,
): Promise<Grant> {
  const expiresAt = new Date(Date.now() + GRANT_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("support_impersonation_grants")
    .insert({ org_id: orgId, admin_id: adminId, scope: "read_only", reason, expires_at: expiresAt })
    .select(GRANT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return toGrant(data as GrantRow);
}

/** The caller's currently-active grant for an org (unrevoked + unexpired), or null. Gate for view-as reads. */
export async function getActiveGrant(admin: SupabaseClient, adminId: string, orgId: string): Promise<Grant | null> {
  const { data } = await admin
    .from("support_impersonation_grants")
    .select(GRANT_COLS)
    .eq("admin_id", adminId)
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toGrant(data as GrantRow) : null;
}

/** All of the caller's active grants (for the "you are impersonating" banner + management). */
export async function listActiveGrants(admin: SupabaseClient, adminId: string): Promise<Grant[]> {
  const { data } = await admin
    .from("support_impersonation_grants")
    .select(GRANT_COLS)
    .eq("admin_id", adminId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return ((data ?? []) as GrantRow[]).map(toGrant);
}

/** Revoke one of the caller's own grants. Returns false if it isn't theirs / doesn't exist. */
export async function revokeGrant(admin: SupabaseClient, adminId: string, grantId: string): Promise<boolean> {
  const { data } = await admin
    .from("support_impersonation_grants")
    .select("id, admin_id")
    .eq("id", grantId)
    .maybeSingle();
  if (!data || (data as { admin_id: string }).admin_id !== adminId) return false;
  await admin
    .from("support_impersonation_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId);
  return true;
}

export interface ViewAnomaly {
  id: string;
  ruleId: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

/** A representative read-only "view as customer" fetch: the org's recent anomalies. Grant-gated by caller. */
export async function viewOrgAnomalies(admin: SupabaseClient, orgId: string): Promise<ViewAnomaly[]> {
  const { data } = await admin
    .from("anomalies")
    .select("id, rule_id, severity, status, message, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as { id: string; rule_id: string; severity: string; status: string; message: string; created_at: string }[]).map(
    (a) => ({ id: a.id, ruleId: a.rule_id, severity: a.severity, status: a.status, message: a.message, createdAt: a.created_at }),
  );
}

/**
 * Mirror a platform action into the CUSTOMER'S own audit_logs (actor = the platform admin's auth user),
 * so platform involvement is transparent in the tenant's trail — not just our internal log.
 */
export async function writeTenantAudit(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string | null,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await admin.from("audit_logs").insert({ org_id: orgId, actor_id: actorUserId, action, meta });
}
