import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage.vue";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage.vue";

/**
 * The two public pages of a password reset (0363, PASSWORD-RESET-PLAN.md).
 *
 * The reset page is pinned on the invitation page's central property (`AcceptInvitePage.test.ts`):
 * LOADING SPENDS NOTHING. A mail scanner renders the link; the page may read on load, and only a
 * submitted password reaches `redeem`. The forgot page is pinned on the other one: it says the same
 * thing for every address, because telling an anonymous visitor which addresses have accounts is the
 * leak a reset form is known for.
 */
type ApiAnswer = { ok: boolean; status: number; data?: unknown; error?: { code: string; message: string } };
const calls = vi.hoisted(() => ({ api: [] as Array<{ path: string; body: unknown }>, auth: [] as string[] }));
const api = vi.hoisted(() => ({
  lookup: {} as ApiAnswer,
  redeem: {} as ApiAnswer,
  request: {} as ApiAnswer,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, opts?: { body?: unknown }) => {
    calls.api.push({ path, body: opts?.body });
    if (path.endsWith("/lookup")) return api.lookup;
    if (path.endsWith("/redeem")) return api.redeem;
    if (path.endsWith("/request")) return api.request;
    return { ok: false, status: 500 };
  }),
}));

const storeSession = vi.hoisted(() => ({ value: null as unknown }));
const push = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get session() {
      return storeSession.value;
    },
    hasOrg: true,
    signIn: vi.fn(async (email: string, password: string) => {
      calls.auth.push(`signIn:${email}:${password}`);
      storeSession.value = { user: { id: "u1" } };
    }),
    syncFromClient: vi.fn(async () => undefined),
  }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: query.value }) }));

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz";
const mountPage = (component: typeof ResetPasswordPage) =>
  mount(component, { global: { plugins: [createPinia()], stubs: { RouterLink: { template: "<a><slot /></a>" } } } });

beforeEach(() => {
  setActivePinia(createPinia());
  calls.api.length = 0;
  calls.auth.length = 0;
  push.mockClear();
  storeSession.value = null;
  query.value = { token: TOKEN };
  api.lookup = { ok: true, status: 200, data: { email: "pavlin@silvicominc.com", expiresAt: "2026-09-23T21:00:00Z" } };
  api.redeem = { ok: true, status: 200, data: { ok: true, email: "pavlin@silvicominc.com" } };
  api.request = { ok: true, status: 202, data: { ok: true } };
});

async function submit(w: ReturnType<typeof mountPage>, pw: string, confirm = pw) {
  await w.findAll("input")[0]!.setValue(pw);
  await w.findAll("input")[1]!.setValue(confirm);
  await w.find("form").trigger("submit");
  await flushPromises();
}

describe("ResetPasswordPage", () => {
  it("reads the link on load and spends nothing — no redeem, no sign-in", async () => {
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    expect(calls.api).toEqual([{ path: "/api/public/password-reset/lookup", body: { token: TOKEN } }]);
    expect(calls.auth).toEqual([]);
    expect(w.text()).toContain("pavlin@silvicominc.com");
  });

  it("says a dead link is dead before anybody types, and offers a new one", async () => {
    api.lookup = { ok: false, status: 404, error: { code: "invalid_link", message: "gone" } };
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    expect(w.text()).toContain("This link can't be used");
    expect(w.text()).toContain("Send a new reset link");
    expect(w.find("form").exists()).toBe(false);
  });

  it("does not even call the API for a URL with no token", async () => {
    query.value = {};
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    expect(calls.api).toEqual([]);
    expect(w.text()).toContain("This link can't be used");
  });

  it("refuses a password the shared rule refuses, without spending the link", async () => {
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    await submit(w, "short");
    expect(w.text()).toContain("Use at least 12 characters.");
    await submit(w, "correct horse battery", "correct horse batterY");
    expect(w.text()).toContain("Passwords do not match.");
    expect(calls.api.map((c) => c.path)).toEqual(["/api/public/password-reset/lookup"]);
  });

  it("spends the link with the new password, then signs in with it", async () => {
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    await submit(w, "correct horse battery");
    expect(calls.api[1]).toEqual({ path: "/api/public/password-reset/redeem", body: { token: TOKEN, password: "correct horse battery" } });
    expect(calls.auth).toEqual(["signIn:pavlin@silvicominc.com:correct horse battery"]);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows the project's own password policy as a retryable error", async () => {
    api.redeem = { ok: false, status: 422, error: { code: "weak_password", message: "Password is known to be weak and easy to guess" } };
    const w = mountPage(ResetPasswordPage);
    await flushPromises();
    await submit(w, "correct horse battery");
    expect(w.text()).toContain("known to be weak");
    expect(w.find("form").exists()).toBe(true);
    expect(calls.auth).toEqual([]);
  });
});

describe("ForgotPasswordPage", () => {
  it("sends the trimmed address and then says only 'if that address has an account'", async () => {
    const w = mountPage(ForgotPasswordPage);
    await w.find("input").setValue("  pavlin@silvicominc.com ");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(calls.api).toEqual([{ path: "/api/public/password-reset/request", body: { email: "pavlin@silvicominc.com" } }]);
    expect(w.text()).toContain("Check your email");
    expect(w.text()).toContain("If pavlin@silvicominc.com has a Silvicom 360 account");
  });

  it("tells a rate-limited visitor to wait, rather than claiming a link was sent", async () => {
    api.request = { ok: false, status: 429 };
    const w = mountPage(ForgotPasswordPage);
    await w.find("input").setValue("pavlin@silvicominc.com");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("Too many requests");
    expect(w.text()).not.toContain("Check your email");
  });
});
