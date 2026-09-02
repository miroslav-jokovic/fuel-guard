import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AcceptInvitePage from "@/pages/auth/AcceptInvitePage.vue";

/**
 * The invite landing page (2026-09-02).
 *
 * What is pinned here is the set of arrivals that used to be indistinguishable. Before this page
 * redeemed its own token, the route was `requiresAuth: true` and supabase-js's `detectSessionInUrl`
 * was the only thing that could produce a session — so a `token_hash` link, a spent link and an
 * expired link all left `isAuthenticated` false, and the router guard turned all three into the same
 * silent redirect to /login. That is why "the invite link goes to the login page" was one report
 * covering several different faults, and why each of them gets its own assertion below.
 *
 * The page is mounted directly rather than through the router: the guard is the thing that used to
 * intercept, and `routeTable.test.ts` ("names every route reachable without a session") is what
 * pins that it no longer can.
 */
const authCalls: string[] = [];
const auth = vi.hoisted(() => ({
  verifyOtpError: null as { message: string } | null,
  sessionAfter: { user: { id: "u1" } } as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  DEV_BYPASS: false,
  supabase: {
    auth: {
      verifyOtp: vi.fn(async () => {
        authCalls.push("verifyOtp");
        return { error: auth.verifyOtpError };
      }),
      setSession: vi.fn(async () => {
        authCalls.push("setSession");
        return { error: null };
      }),
      exchangeCodeForSession: vi.fn(async () => {
        authCalls.push("exchangeCodeForSession");
        return { error: null };
      }),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  },
}));

const storeSession = vi.hoisted(() => ({ value: null as unknown }));
/**
 * `refresh()` ROTATES the refresh token; `syncFromClient()` reads what the client already holds.
 * The store fake keeps them distinct on purpose — collapsing them is exactly the confusion that
 * locked a user out on 2026-09-02, and a fake where both do the same thing could not express it.
 */
const refreshFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get session() {
      return storeSession.value;
    },
    refresh: vi.fn(async () => {
      // Real `refresh()` swallows its error and leaves the store untouched when the rotation fails.
      if (refreshFails.value) return;
      storeSession.value = auth.sessionAfter;
    }),
    syncFromClient: vi.fn(async () => {
      storeSession.value = auth.sessionAfter;
    }),
  }),
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: {} })) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function mountAt(url: string) {
  window.history.replaceState({}, "", url);
  return mount(AcceptInvitePage, {
    global: {
      plugins: [createPinia()],
      stubs: { RouterLink: { template: "<a><slot /></a>" } },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  authCalls.length = 0;
  auth.verifyOtpError = null;
  auth.sessionAfter = { user: { id: "u1" } };
  refreshFails.value = false;
  storeSession.value = null;
});

describe("AcceptInvitePage", () => {
  it("redeems the token_hash link we now email and shows the password form", async () => {
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(authCalls).toEqual(["verifyOtp"]);
    expect(w.text()).toContain("Set your password");
  });

  it("still accepts the implicit-grant fragment, for links already sitting in inboxes", async () => {
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    expect(authCalls).toEqual(["setSession"]);
    expect(w.text()).toContain("Set your password");
  });

  /**
   * The report. A mail-security scanner GETs the link before the recipient does, GoTrue spends the
   * token, and the human's click arrives carrying an error fragment instead of a session. The page
   * must NAME that, because the alternative — what shipped — is a login screen the user reads as
   * "my password is wrong".
   */
  it("explains a link a scanner or a second click already spent, instead of failing silently", async () => {
    const w = mountAt(
      "/accept-invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await flushPromises();
    expect(authCalls).toEqual([]); // nothing to redeem — don't call Supabase to be told so
    expect(w.text()).toContain("expired or was already used");
    expect(w.text()).toContain("Ask your administrator to resend");
    expect(w.text()).not.toContain("Set your password");
  });

  it("explains an expired token rather than showing a form that cannot be submitted", async () => {
    auth.verifyOtpError = { message: "Token has expired or is invalid" };
    const w = mountAt("/accept-invite?token_hash=stale&type=invite");
    await flushPromises();
    expect(w.text()).toContain("expired or was already used");
    expect(w.text()).not.toContain("Set your password");
  });

  it("does not offer a password form when redemption succeeded but no session landed", async () => {
    auth.sessionAfter = null;
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(w.text()).not.toContain("Set your password");
    // …and says the right thing. A link that redeemed fine is not a spent link, and telling somebody
    // to ask for a resend when the token worked sends them round a loop that cannot end.
    expect(w.text()).not.toContain("expired or was already used");
    expect(w.text()).toContain("couldn't sign you in");
  });

  /**
   * THE LOCKOUT (production, 2026-09-02). `verifyOtp` succeeded — the server recorded the sign-in —
   * and the page still said "this invitation link has expired", because it reached for `refresh()`
   * to populate the store. That call rotates a refresh token issued seconds earlier; when the
   * rotation failed the store stayed null and this page read null as "the link was bad".
   *
   * The invited user therefore never saw a password form, `/api/invites/accept` was never called,
   * and no membership was ever created — while their account existed, confirmed, with a password.
   * Nothing in the flow could tell them that, and re-inviting reproduced it exactly.
   */
  it("shows the password form even when a token rotation would have failed", async () => {
    refreshFails.value = true;
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(authCalls).toEqual(["verifyOtp"]);
    expect(w.text()).toContain("Set your password");
    expect(w.text()).not.toContain("expired or was already used");
  });

  it("keeps the credential out of the address bar once redeemed", async () => {
    mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/accept-invite");
  });

  /**
   * supabase-js may consume the fragment itself during `session.init()`, leaving a bare URL and a
   * signed-in user. Reading that as "not an invitation link" would break the one arrival that
   * worked before this change.
   */
  it("shows the form to an already-signed-in arrival whose URL has been stripped", async () => {
    storeSession.value = { user: { id: "u1" } };
    const w = mountAt("/accept-invite");
    await flushPromises();
    expect(authCalls).toEqual([]);
    expect(w.text()).toContain("Set your password");
  });

  it("tells a bare visitor with no session that this is not an invitation link", async () => {
    const w = mountAt("/accept-invite");
    await flushPromises();
    expect(w.text()).toContain("doesn’t look like an invitation link");
  });
});
