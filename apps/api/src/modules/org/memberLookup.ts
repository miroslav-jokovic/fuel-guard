import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Which role does this person hold in THIS org?" — asked by every per-user permission route
 * (SURFACE-ENTITLEMENTS-PLAN.md S4/S5/S6).
 *
 * ── WHY IT IS ONE FUNCTION AND NOT FOUR COPIES ──────────────────────────────────────────────────
 * Four routes need it: the two per-user PUTs (`section-access/user`, `surface-access/user`) and the
 * two per-user GETs S6 added to draw the page they write from. Each was six identical lines, and the
 * lines are not incidental — they are where D-PERM7/D-PERM8's role lock reads the role it locks on,
 * and where an admin's request is confined to their OWN tenant. A copy of that is a copy with a
 * delay fuse: the fifth caller writes it slightly differently and the difference is a cross-tenant
 * read that nothing refuses.
 *
 * ⚠ The `.eq("org_id")` is the security half, not the convenience half. The API reads with the
 * SERVICE ROLE, which bypasses RLS, so this filter is the only thing standing between an admin and
 * another tenant's membership rows — and the caller sees a clean "not a member of this
 * organisation" rather than a foreign-key 500 from a write it should never have reached.
 *
 * The role LOCK itself stays with each caller, because the callers disagree about it on purpose: a
 * write must refuse an `admin` or `driver` member (D-PERM7/D-PERM8), while a read must still show an
 * admin what that member's access is. This function answers the question; it does not rule on it.
 */
export type MemberRoleLookup =
  | { ok: true; role: string }
  | { ok: false; reason: "db_error" | "not_found" };

export async function lookupMemberRole(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<MemberRoleLookup> {
  const { data, error } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, reason: "db_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, role: (data as { role: string }).role };
}
