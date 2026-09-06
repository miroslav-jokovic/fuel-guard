import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AcceptInvitePage from "@/pages/auth/AcceptInvitePage.vue";

/**
 * The invite landing page (rewritten 2026-09-04 around the invitation's OWN token).
 *
 * ⚠ THE CENTRAL PROPERTY, and the one to protect above the others: loading this page must spend
 * NOTHING. Production measured three sends (2026-09-02) whose one-time token was redeemed 15, 47
 * and 25 seconds after leaving — the recipient's mail security opens the link and executes
 * JavaScript. With our own token the page may READ on load (the lookup), and the one call that
 * spends the token needs a password. What is pinned below is exactly that split: which call runs
 * when, and that GoTrue is never asked to verify anything from this page.
 *
 * The other production loss (2026-09-03) was a token that expired in an hour while the email said
 * seven days. That is now impossible by construction — there is no GoTrue token in the link — so
 * it is pinned on the API side (`inviteRedemption`), not here.
 *
 * The page is mounted directly rather than through the router: the guard is the thing that used to
 * intercept, and `routeTable.test.ts` ("names every route reachable without a session") is what
 * pins that it no longer can.
 */
const calls = vi.hoisted(() => ({ api: [] as Array<{ path: string; body: unknown }>, auth: [] as string[] }));
const api = vi.hoisted(() => ({
  lookup: { ok: true, status: 200, data: { email: "nadia@example.test", orgName: "Silvicom Inc", role: "dispatcher", fullName: "Nadia Named", expiresAt: null } } as { ok: boolean; status: number; data?: unknown; error?: { code: string; message: string } },
  redeem: { ok: true, status: 200, data: { ok: true, email: "nadia@example.test" } } as { ok: boolean; status: number; data?: unknown; error?: { code: string; message: string } },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, opts?: { body?: unknown }) => {
    calls.api.push({ path, body: opts?.body });
    if (path.endsWith("/lookup")) return api.lookup;
    if (path.endsWith("/redeem")) return api.redeem;
    return { ok: false, status: 500 };
  }),
}));

vi.mock("@/lib/supabase", () => ({
  DEV_BYPASS: false,
  supabase: {
    auth: {
      verifyOtp: vi.fn(async () => {
        calls.auth.push("verifyOtp");
        return { error: null };
      }),
      setSession: vi.fn(async () => {
        calls.auth.push("setSession");
        return { error: null };
      }),
    },
  },
}));

const storeSession = vi.hoisted(() => ({ value: null as unknown, signInFails: false }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get session() {
      return storeSession.value;
    },
    signIn: vi.fn(async (email: string, password: string) => {
      calls.auth.push(`signIn:${email}:${password}`);
      if (storeSession.signInFails) throw new Error("Invalid login credentials");
      storeSession.value = { user: { id: "u1" } };
    }),
    syncFromClient: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

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
  calls.api.length = 0;
  calls.auth.length = 0;
  push.mockClear();
  storeSession.value = null;
  storeSession.signInFails = false;
  api.lookup = { ok: true, status: 200, data: { email: "nadia@example.test", orgName: "Silvicom Inc", role: "dispatcher", fullName: "Nadia Named", expiresAt: null } };
  api.redeem = { ok: true, status: 200, data: { ok: true, email: "nadia@example.test" } };
});

const LINK = "/accept-invite?token=tok_abcdefghijklmnopqrstuvwxyz";

/** Fill the form and submit — the only thing that may spend a token. */
async function submitPassword(w: ReturnType<typeof mountAt>, pw = "correcthorse", name?: string) {
  if (name !== undefined) await w.findAll("input")[0]!.setValue(name);
  await w.findAll("input")[1]!.setValue(pw);
  await w.findAll("input")[2]!.setValue(pw);
  await w.find("form").trigger("submit");
  await flushPromises();
}

describe("AcceptInvitePage — loading reads and spends nothing", () => {
  it("looks the invitation up on mount and asks GoTrue for nothing", async () => {
    const w = mountAt(LINK);
    await flushPromises();
    expect(calls.api.map((c) => c.path)).toEqual(["/api/public/invites/lookup"]);
    expect(calls.api[0]!.body).toEqual({ token: "tok_abcdefghijklmnopqrstuvwxyz" });
    expect(calls.auth).toEqual([]);
    expect(w.text()).toContain("Join Silvicom Inc");
    expect(w.text()).toContain("Dispatcher");
    expect(w.text()).toContain("nadia@example.test");
  });

  it("pre-fills the name the admin typed on the invitation", async () => {
    const w = mountAt(LINK);
    await flushPromises();
    expect((w.findAll("input")[0]!.element as HTMLInputElement).value).toBe("Nadia Named");
  });

  /**
   * The trade the 2026-09-02 page made — "a link's validity is UNKNOWN until submit" — is undone:
   * a dead link is refused before the person has typed a password, because the lookup is a read.
   */
  it("says a dead link is dead before anybody types a password", async () => {
    api.lookup = { ok: false, status: 404, error: { code: "invalid_link", message: "This invitation link is no longer valid." } };
    const w = mountAt(LINK);
    await flushPromises();
    expect(w.text()).toContain("no longer valid");
    expect(w.text()).toContain("send a new invitation");
    expect(w.find("form").exists()).toBe(false);
  });

  it("leaves the token in the URL until it is spent, so a reload can still use it", async () => {
    mountAt(LINK);
    await flushPromises();
    expect(window.location.search).toContain("token=tok_");
  });

  /**
   * Links emailed before 2026-09-04 carried a GoTrue credential. They are all dead — spent by a
   * scanner or an hour past their expiry — and the page must say "earlier kind of invitation" rather
   * than try `verifyOtp`, which is the call a scanner could race.
   */
  it("refuses a GoTrue-shaped link from the old flow without calling Supabase", async () => {
    const w = mountAt("/accept-invite?token_hash=abc&type=invite");
    await flushPromises();
    expect(calls.api).toEqual([]);
    expect(calls.auth).toEqual([]);
    expect(w.text()).toContain("earlier kind of invitation");
  });

  it("refuses an implicit-grant fragment the same way", async () => {
    const w = mountAt("/accept-invite#access_token=at&refresh_token=rt&type=invite");
    await flushPromises();
    expect(calls.auth).toEqual([]);
    expect(w.text()).toContain("earlier kind of invitation");
  });

  it("tells a bare visitor that this is not an invitation link", async () => {
    const w = mountAt("/accept-invite");
    await flushPromises();
    expect(calls.api).toEqual([]);
    expect(w.text()).toContain("doesn’t look like an invitation link");
  });
});

describe("AcceptInvitePage — submitting redeems, then signs in", () => {
  it("redeems with the token, password and trimmed name, then signs in with the invited address", async () => {
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w, "correcthorse", "  Nadia Named ");
    expect(calls.api.map((c) => c.path)).toEqual(["/api/public/invites/lookup", "/api/public/invites/redeem"]);
    expect(calls.api[1]!.body).toEqual({
      token: "tok_abcdefghijklmnopqrstuvwxyz",
      password: "correcthorse",
      fullName: "Nadia Named",
    });
    expect(calls.auth).toEqual(["signIn:nadia@example.test:correcthorse"]);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("clears the token out of the address bar once it is spent", async () => {
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w);
    expect(window.location.search).toBe("");
  });

  it("will not redeem without a name — the token is spent only by a complete form", async () => {
    api.lookup = { ok: true, status: 200, data: { email: "nadia@example.test", orgName: "Silvicom Inc", role: "dispatcher", fullName: null, expiresAt: null } };
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w);
    expect(calls.api.map((c) => c.path)).toEqual(["/api/public/invites/lookup"]);
    expect(w.text()).toContain("Tell us your name.");
  });

  it("says the link died when redemption answers 404, rather than blaming the password", async () => {
    api.redeem = { ok: false, status: 404, error: { code: "invalid_link", message: "gone" } };
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w);
    expect(w.text()).toContain("no longer valid");
    expect(w.find("form").exists()).toBe(false);
    expect(calls.auth).toEqual([]);
  });

  it("shows the project's password policy as a retryable error on the form", async () => {
    api.redeem = { ok: false, status: 422, error: { code: "weak_password", message: "Password should be at least 12 characters." } };
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w);
    expect(w.text()).toContain("at least 12 characters");
    expect(w.find("form").exists()).toBe(true);
  });

  /**
   * The membership was written by the redeem call; only the sign-in failed. Sending this person to
   * "ask for a resend" would loop them through an invitation that is now ACCEPTED and dead.
   */
  it("tells a person whose account was created but sign-in failed to use the login page", async () => {
    storeSession.signInFails = true;
    const w = mountAt(LINK);
    await flushPromises();
    await submitPassword(w);
    expect(w.text()).toContain("Invalid login credentials");
    expect(w.text()).not.toContain("send a new invitation");
    expect(push).not.toHaveBeenCalled();
  });
});
