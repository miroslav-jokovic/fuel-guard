import type { SupabaseClient } from "@supabase/supabase-js";
import { rolesThatManage } from "@silvicom/shared";

/** Who hears a finance finding: every member holding `accounting` manage (D-FIN3, D-FIN14). */
const OFFICE_ROLES = rolesThatManage("accounting");

export async function officeUserIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin.from("memberships").select("user_id").eq("org_id", orgId).in("role", OFFICE_ROLES);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
}
