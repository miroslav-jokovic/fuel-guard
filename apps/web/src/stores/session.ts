import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Session } from "@supabase/supabase-js";
import type { UserRole } from "@fuelguard/shared";
import { canManageFleet, isAdmin, isReadOnly } from "@fuelguard/shared";
import { supabase, DEV_BYPASS } from "@/lib/supabase";
import { decodeClaims } from "@/lib/jwt";

/** Builds a fake-but-structurally-valid session for local UI development (VITE_DEV_BYPASS=true).
 *  The JWT payload is not signed — frontend only decodes it (never verifies) per decodeClaims(). */
function makeDevSession(): Session {
  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "dev-admin-001",
    email: "miki@silvicominc.com",
    org_id: "dev-org-silvicom",
    user_role: "admin",
    iat: now,
    exp: now + 86400 * 365,
  };
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.dev-sig`;
  return {
    access_token: token,
    refresh_token: "dev-refresh",
    expires_in: 86400 * 365,
    expires_at: now + 86400 * 365,
    token_type: "bearer",
    user: {
      id: "dev-admin-001",
      email: "miki@silvicominc.com",
      app_metadata: { provider: "email" },
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as Session["user"],
  } as Session;
}

export const useSessionStore = defineStore("session", () => {
  const session = ref<Session | null>(null);
  const initialized = ref(false);

  // Derived identity from the verified-by-Supabase access token (claims set by the auth hook).
  const claims = computed(() => decodeClaims(session.value?.access_token));
  const userId = computed(() => session.value?.user.id ?? null);
  const email = computed(() => session.value?.user.email ?? null);
  const orgId = computed(() => claims.value?.org_id ?? null);
  const role = computed<UserRole | null>(() => claims.value?.user_role ?? null);

  const isAuthenticated = computed(() => !!session.value);
  const hasOrg = computed(() => !!orgId.value); // false ⇒ "account pending" (audit B3)
  const canManage = computed(() => canManageFleet(role.value));
  const admin = computed(() => isAdmin(role.value));
  const readOnly = computed(() => isReadOnly(role.value));

  async function init() {
    if (DEV_BYPASS) {
      session.value = makeDevSession();
      initialized.value = true;
      return;
    }
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s;
    });
    initialized.value = true;
  }

  async function signIn(emailAddr: string, password: string) {
    if (DEV_BYPASS) return;
    const { error } = await supabase.auth.signInWithPassword({ email: emailAddr, password });
    if (error) throw error;
  }

  async function signOut() {
    // Clear local state FIRST so route guards immediately see "logged out" (no waiting on the network).
    session.value = null;
    try {
      // `local` scope clears the stored tokens without a server round-trip that can hang/stall.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* already cleared locally — ignore */
    }
  }

  /** Re-fetch the token so newly-created membership claims (org_id/user_role) appear (audit B3). */
  async function refresh() {
    if (DEV_BYPASS) return;
    const { data } = await supabase.auth.refreshSession();
    if (data.session) session.value = data.session;
  }

  return {
    session,
    initialized,
    userId,
    email,
    orgId,
    role,
    isAuthenticated,
    hasOrg,
    canManage,
    admin,
    readOnly,
    init,
    signIn,
    signOut,
    refresh,
  };
});
