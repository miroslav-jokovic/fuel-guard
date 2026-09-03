import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AcceptInvitePage from "@/pages/auth/AcceptInvitePage.vue";

/**
 * The invite landing page (2026-09-02).
 *
 * ⚠ THE CENTRAL PROPERTY, and the one to protect above the others: loading this page must spend
 * NOTHING. Production measured three sends whose one-time token was redeemed 15, 47 and 25 seconds
 * after leaving — the recipient's mail security opens the link and executes JavaScript, so a page
 * that redeemed on mount handed the scanner the session and left the human with "expired". Twice
 * over two days, with two different link formats.
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

/** Fill the form and submit — the only thing that may spend a token. */
async function submitPassword(w: ReturnType<typeof mountAt>, pw = "correcthorse", name = "Nadia Named") {
  // Name first (0301), then the password twice.
  await w.findAll("input")[0]!.setValue(name);
  await w.findAll("input")[1]!.setValue(pw);
  await w.findAll("input")[2]!.setValue(pw);
  await w.find("form").trigger("submit");
  await flushPromises();
}

describe("AcceptInvitePage — loading spends nothing", () => {
  /**
   * The regression that matters. A mail scanner that renders the page gets a form and stops,
   * because it has no password to submit; the token is spent by the one action a machine will not
   * take on the recipient's behalf.
   */
  it("does NOT redeem a token_hash link on mount — it only offers the form", async () => {
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(authCalls).toEqual([]);
    expect(w.text()).toContain("Set your password");
  });

  it("does NOT redeem an implicit-grant fragment on mount either", async () => {
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    expect(authCalls).toEqual([]);
    expect(w.text()).toContain("Set your password");
  });

  it("leaves the credential in the URL until it is spent, so a reload can still use it", async () => {
    mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(window.location.search).toContain("token_hash=abc");
  });
});

describe("AcceptInvitePage — submitting redeems", () => {
  it("redeems the token_hash link on submit", async () => {
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    await submitPassword(w);
    expect(authCalls).toEqual(["verifyOtp"]);
  });

  it("redeems an implicit-grant fragment on submit", async () => {
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    await submitPassword(w);
    expect(authCalls).toEqual(["setSession"]);
  });

  it("clears the credential out of the address bar once it is spent", async () => {
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    await submitPassword(w);
    expect(window.location.search).toBe("");
  });

  it("says the link is spent when redemption fails, rather than blaming the password", async () => {
    auth.verifyOtpError = { message: "Token has expired or is invalid" };
    const w = mountAt("/accept-invite?token_hash=stale&type=invite");
    await flushPromises();
    await submitPassword(w);
    expect(w.text()).toContain("already been used or has expired");
    expect(w.text()).not.toContain("Set your password");
  });

  /**
   * An error fragment needs no network call to recognise, so this one IS decided on load — GoTrue
   * redirected with it, the link is already spent, and offering a form would waste the person's time.
   */
  it("explains a link that arrived already spent, without calling Supabase to be told so", async () => {
    const w = mountAt(
      "/accept-invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await flushPromises();
    expect(authCalls).toEqual([]);
    expect(w.text()).toContain("expired or was already used");
    expect(w.text()).toContain("Ask your admin to resend it");
    expect(w.text()).not.toContain("Set your password");
  });

  it("says the right thing when redemption succeeded but no session landed", async () => {
    auth.sessionAfter = null;
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    await submitPassword(w);
    // A link that redeemed fine is not a spent link, and telling somebody to ask for a resend when
    // the token worked sends them round a loop that cannot end.
    expect(w.text()).toContain("couldn't sign you in");
    expect(w.text()).not.toContain("already been used");
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
  it("completes even when a token rotation would have failed", async () => {
    refreshFails.value = true;
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    await submitPassword(w);
    expect(authCalls).toEqual(["verifyOtp"]);
    // Not sent to the "this link can't be used" screen, and not told the link expired.
    expect(w.text()).not.toContain("already been used");
    expect(w.text()).not.toContain("couldn't sign you in");
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

describe("AcceptInvitePage — the person says who they are (0301)", () => {
  it("sends the typed name with the acceptance, trimmed, and nothing else in the body", async () => {
    const { apiFetch } = await import("@/lib/api");
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    await submitPassword(w, "correcthorse", "  Nadia Named ");
    expect(apiFetch).toHaveBeenCalledWith("/api/invites/accept", { method: "POST", body: { fullName: "Nadia Named" } });
  });

  it("will not redeem the link without a name — the token is spent only by a complete form", async () => {
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    await w.findAll("input")[1]!.setValue("correcthorse");
    await w.findAll("input")[2]!.setValue("correcthorse");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(authCalls).toEqual([]);
    expect(w.text()).toContain("Tell us your name.");
  });
});
