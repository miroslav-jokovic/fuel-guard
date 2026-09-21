import type { SupabaseClient } from "@supabase/supabase-js";
import { usersWhoManage } from "../org/index.js";

/** Who hears a finance finding: every member holding `accounting` manage (D-FIN3, D-FIN14). */
export async function officeUserIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  return usersWhoManage(admin, orgId, "accounting");
}
