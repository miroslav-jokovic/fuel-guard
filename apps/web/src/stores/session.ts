import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Session } from "@supabase/supabase-js";
import type { UserRole } from "@silvicom/shared";
import {
  callerCanManage,
  callerCanView,
  canReadAllRestricted,
  canReadRestrictedKind,
  isAdmin,
  isReadOnly,
  type AppSection,
  type SectionClaim,
} from "@silvicom/shared";
import { supabase, DEV_BYPASS } from "@/lib/supabase";
import { decodeClaims } from "@/lib/jwt";
import { clearStepUp } from "@/lib/stepUp";

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
  /**
   * The org's overrides of this user's role, off the same verified token as `role` (D-PERM2).
   *
   * `null` for a token minted before migration 0292 — which is every token in existence on the day
   * it applies — and that reads as "no overrides", never as "deny everything". `can()` below falls
   * through to the shipped matrix in that case, so this store answered exactly the same questions
   * the same way before the claim existed.
   */
  const sections = computed<SectionClaim | null>(() => claims.value?.sections ?? null);

  const isAuthenticated = computed(() => !!session.value);
  const hasOrg = computed(() => !!orgId.value); // false ⇒ "account pending" (audit B3)
  /**
   * ── THE CAPABILITY SURFACE (R0, D-ROS7) ────────────────────────────────────────────────────────
   * `session.canManage` used to live here: ONE boolean, `canManageFleet` (admin || fleet_manager),
   * standing in for the whole section × role matrix that the API and the database already model
   * correctly. Fifty call sites across twenty components asked it, and they did not all mean the
   * same thing — a fact nothing could express, so nothing did.
   *
   * What that cost is worth remembering, because it is the reason this file changed: a
   * `safety_manager` held `fleet: manage` in the matrix and got a read-only screen; a `recruiter`
   * held `recruitment: manage` and had recruiting write affordances hidden, which is why recruiting
   * UI was placed on the driver page instead; an `accountant` held `accounting: manage` and the same
   * boolean said no. Three sections modelled correctly everywhere except the surface people use.
   *
   * `can(section)` and `canView(section)` are thin on purpose — the matrix is the source of truth
   * and this is a Vue-shaped door onto it, never a second opinion about it.
   *
   * Since P3 they resolve the ORG'S matrix rather than the shipped one: `callerCanManage` layers the
   * `sections` claim over `SECTION_ACCESS`, which is the same function the API's `requireSection`
   * gate calls. One rule, asked from two places — the alternative, a web-side reimplementation of
   * the layering, is precisely the second opinion this comment has always warned against.
   */
  const can = (section: AppSection): boolean => callerCanManage(role.value, section, sections.value);
  const canView = (section: AppSection): boolean => callerCanView(role.value, section, sections.value);
  const admin = computed(() => isAdmin(role.value));
  const readOnly = computed(() => isReadOnly(role.value));
  /**
   * BOTH halves of the restricted set — the whole-file entitlement (auth.ts's split, 2026-08-19).
   * Gates the binder's include-restricted checkbox and nothing per-requirement; a recruiter holds
   * §391.53 investigation history without holding this.
   */
  const restrictedAccess = computed(() => canReadAllRestricted(role.value));
  /** Per requirement, which is the question every row-level affordance actually asks. */
  const canReadKind = (kind: string): boolean => canReadRestrictedKind(kind, role.value);

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
    // A step-up token must never outlive the session that earned it (audit P0-4).
    clearStepUp();
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
    sections,
    isAuthenticated,
    hasOrg,
    can,
    canView,
    admin,
    readOnly,
    restrictedAccess,
    canReadKind,
    init,
    signIn,
    signOut,
    refresh,
  };
});
