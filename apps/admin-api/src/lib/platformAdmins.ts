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
    const byEmail = await admin
      .from("platform_admins")
      .select("id, email, user_id, role, status, mfa_enrolled_at, last_reauth_at")
      .eq("email", identity.email)
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
