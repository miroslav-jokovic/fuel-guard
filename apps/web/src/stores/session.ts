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
  type SurfaceClaim,
} from "@silvicom/shared";
import { supabase, DEV_BYPASS } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
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

  /**
   * The org's answers about which SCREENS this role may reach (D-SURF1, S3).
   *
   * ⚠ NOT from the token, and that asymmetry with `sections` above is deliberate (D-SURF4). Sections
   * must be a claim because RLS reads them per row and `auth_section()` has to inline. Nothing in RLS
   * reads a surface, so a claim would buy nothing and cost the hour of staleness `jwt_expiry = 3600`
   * implies. Fetched in `init()` instead, which the router guard already awaits, so a screen change
   * lands on the next page load rather than the next token refresh.
   *
   * `null` until fetched, and `{}` when the org has answered nothing — both read as "no denials".
   * That is a fail-OPEN and it is safe by construction: a surface entitlement may only NARROW within
   * a section (D-SURF2), so the worst an empty answer can do is show the shipped catalogue.
   */
  const surfaces = ref<SurfaceClaim | null>(null);
  /** The caller's display name from `/api/me` (0301); null until loaded or when they have none. */
  const fullName = ref<string | null>(null);

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
      // A new token can be a different member of a different org, so the screen answers that came
      // with the old one must not outlive it. Cleared rather than refetched: `null` is "no denials",
      // which is the safe reading while the next `loadSurfaces()` is in flight.
      surfaces.value = null;
      fullName.value = null;
    });
    // Before `initialized`, so the router guard — which awaits this whole function — never resolves
    // a route against an answer that has not arrived. A failure leaves `null`, which denies nothing.
    await loadSurfaces();
    initialized.value = true;
  }

  /** Fetch this caller's screen entitlements. Silent on failure, for the reason `surfaces` states. */
  async function loadSurfaces() {
    if (!session.value) return;
    const res = await apiFetch<{ surfaces?: SurfaceClaim; fullName?: string | null }>("/api/me");
    surfaces.value = res.ok ? (res.data?.surfaces ?? {}) : null;
    fullName.value = res.ok ? (res.data?.fullName ?? null) : null;
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

  /**
   * Adopt whatever session the Supabase client already holds.
   *
   * NOT the same call as `refresh()` below, and the difference cost a locked-out user on
   * 2026-09-02. `verifyOtp`/`setSession` hand the client a session directly; this store only learns
   * about it through `onAuthStateChange`, which supabase-js dispatches on a `setTimeout(…, 0)` — so
   * an `await` chain immediately afterwards can observe a null store while the client is perfectly
   * signed in. `AcceptInvitePage` reached for `refresh()` to close that gap, which forces a token
   * ROTATION on a refresh token issued seconds earlier; when that raced it failed silently, the
   * store stayed null, and the page reported "this link has expired" to somebody whose sign-in the
   * server had already recorded.
   *
   * Reading is the right verb when the client already has the answer. Rotating is not.
   */
  async function syncFromClient() {
    if (DEV_BYPASS) return;
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
  }

  /**
   * Re-fetch the token so newly-created membership claims (org_id/user_role) appear (audit B3).
   *
   * A rotation is CORRECT here and only here: the claims are minted by the auth hook, so nothing but
   * a new token can carry a membership that did not exist when the current one was issued. Use
   * `syncFromClient()` for "the client signed in, catch up" — see its header for what asking the
   * wrong one costs.
   */
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
    fullName,
    orgId,
    role,
    sections,
    surfaces,
    loadSurfaces,
    isAuthenticated,
    hasOrg,
    can,
    canView,
    admin,
    readOnly,
    restrictedAccess,
    canReadKind,
    init,
    syncFromClient,
    signIn,
    signOut,
    refresh,
  };
});
