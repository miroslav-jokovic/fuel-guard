import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_readonly";

/** The authorized platform administrator, resolved from the allowlist per request. */
export interface PlatformAdmin {
  id: string;
  email: string;
  userId: string | null;
  role: PlatformRole;
  status: "active" | "suspended";
  mfaEnrolledAt: string | null;
  lastReauthAt: string | null;
}

interface Row {
  id: string;
  email: string;
  user_id: string | null;
  role: PlatformRole;
  status: "active" | "suspended";
  mfa_enrolled_at: string | null;
  last_reauth_at: string | null;
}

const toAdmin = (r: Row): PlatformAdmin => ({
  id: r.id,
  email: r.email,
  userId: r.user_id,
  role: r.role,
  status: r.status,
  mfaEnrolledAt: r.mfa_enrolled_at,
  // VESTIGIAL (audit 2026-08-09, finding 3.8). Nothing in this codebase has ever WRITTEN
  // platform_admins.last_reauth_at, so this is always null. Step-up freshness now comes from the
  // caller's JWT `amr` timestamps (middleware/platformAuth.ts), which needs no write path and cannot
  // be refreshed by an attacker holding only a stolen access token. Kept on the type for now so the
  // column drop is a separate, deliberate migration; do not reintroduce a dependency on it.
  lastReauthAt: r.last_reauth_at,
});

/**
 * Authorize a verified identity against the platform allowlist — the single source of truth for
 * cross-tenant power (a fresh lookup EVERY request; no JWT claim carries it, so revocation is instant).
 * Matches by linked user_id first, else by email on first login (and links user_id then). Returns null
 * unless an ACTIVE admin row matches.
 */
export async function lookupPlatformAdmin(
  admin: SupabaseClient,
  identity: { userId: string; email: string | null },
): Promise<PlatformAdmin | null> {
  const byId = await admin
    .from("platform_admins")
    .select("id, email, user_id, role, status, mfa_enrolled_at, last_reauth_at")
    .eq("user_id", identity.userId)
    .maybeSingle();
  let row = (byId.data as Row | null) ?? null;

  if (!row && identity.email) {
    // The email claim alone must NEVER be enough to claim cross-tenant authority (audit 2026-08-09,
    // finding 3.5). platform_admins rows are seeded with user_id NULL and linked on first login, and
    // the seeded addresses are in the repository — so if the project ever allows sign-up without
    // confirming the address, anyone could register the owner's email, self-enrol a TOTP factor to
    // reach aal2, and this fallback would hand them platform_owner over every tenant.
    //
    // Supabase does not put confirmation status in the access token, so it is read from the auth
    // record itself. This costs one round trip on the FIRST login of each platform admin and nothing
    // thereafter, because the user_id link above short-circuits it forever after.
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(identity.userId);
    const confirmedAt = authUser?.user?.email_confirmed_at ?? null;
    const confirmedEmail = authUser?.user?.email?.toLowerCase() ?? null;
    if (authErr || !confirmedAt || !confirmedEmail) return null;
    // The token's claim and the auth record must agree; trust the record, not the claim.
    if (confirmedEmail !== identity.email.toLowerCase()) return null;

    // Emails are stored lower-cased (no citext), so match case-insensitively by lower-casing here.
    const byEmail = await admin
      .from("platform_admins")
      .select("id, email, user_id, role, status, mfa_enrolled_at, last_reauth_at")
      .eq("email", identity.email.toLowerCase())
      .is("user_id", null)
      .maybeSingle();
    row = (byEmail.data as Row | null) ?? null;
    if (row) {
      // Link the auth user on first login so subsequent lookups match by user_id.
      await admin.from("platform_admins").update({ user_id: identity.userId }).eq("id", row.id);
      row = { ...row, user_id: identity.userId };
    }
  }

  if (!row || row.status !== "active") return null;
  return toAdmin(row);
}
