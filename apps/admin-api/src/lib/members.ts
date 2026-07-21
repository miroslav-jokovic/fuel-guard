import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrgMember {
  userId: string;
  email: string | null;
  role: string;
  createdAt: string;
}

/** Members of one org with resolved emails (auth.users via the service-role auth admin API). */
export async function listOrgMembers(admin: SupabaseClient, orgId: string): Promise<OrgMember[]> {
  const { data: rows, error } = await admin
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const members = (rows ?? []) as { user_id: string; role: string; created_at: string }[];
  const out: OrgMember[] = [];
  for (const m of members) {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    out.push({ userId: m.user_id, email: data?.user?.email ?? null, role: m.role, createdAt: m.created_at });
  }
  return out;
}

/**
 * Flip an EXISTING org integration's enabled flag (platform-side kill switch / re-enable). Returns false
 * if the org has no such integration configured — provisioning/token setup stays in the customer flow, so
 * the platform toggle never creates rows or touches secrets. Reversible → audited but not step-up.
 */
export async function setOrgModuleEnabled(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  enabled: boolean,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("org_integrations")
    .select("provider")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  if (!existing) return false;
  await admin
    .from("org_integrations")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", provider);
  return true;
}
