import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

/**
 * Two-step sign-in page, revision 2 (INSTALLED-APP-PLAN IA-S1, Q-IA20). What the person relies on: opening it
 * sends the code and says where it went; the right code lets them in; a wrong one is said in words and nothing
 * changes; "Send a new code" works and says so when one went out moments ago; a failed send is a Retry, not a code
 * box with nothing behind it; the person the guard is holding here has Sign out and no way around the page.
 */
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const session = vi.hoisted(() => ({
  secondFactor: null as null | Record<string, unknown>,
  loadSurfaces: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/api", () => api);
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import TwoStepPage from "./TwoStepPage.vue";

const OWED = { required: true, satisfied: false, email_hint: "a•••@silvicom.com", trusted_until: null };
const SENT = { ok: true, status: 200, data: { outcome: "sent", expires_at: "2026-12-01T12:10:00.000Z" } };
const refusal = (status: number, code: string, message: string) => ({ ok: false, status, error: { code, message } });

let replies: Record<string, unknown>;
beforeEach(() => {
  session.secondFactor = OWED;
  for (const fn of [session.loadSurfaces, session.signOut, push]) fn.mockClear();
  replies = { "/api/me/second-factor/code": SENT, "/api/me/second-factor/verify": { ok: true, status: 200, data: { ok: true } } };
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (path: string) => replies[path]);
});
const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});
async function render() {
  const w = mount(TwoStepPage);
  mounted.push(w);
  await flushPromises();
  return w;
}
const calls = (path: string) => api.apiFetch.mock.calls.filter(([p]) => p === path);
const button = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text().trim() === label);
const enter = async (w: VueWrapper, code: string) => {
  await w.find("input").setValue(code);
  await w.find("form").trigger("submit");
  await flushPromises();
};

describe("a device that owes its code", () => {
  it("sends it on opening and says where it went", async () => {
    const w = await render();
    expect(calls("/api/me/second-factor/code")).toEqual([["/api/me/second-factor/code", { method: "POST" }]]);
    expect(w.get('[data-testid="two-step-lead"]').text()).toContain("a•••@silvicom.com");
    expect(w.get('[data-testid="two-step-lead"]').text()).toContain("7 days");
    expect(w.find("input").exists()).toBe(true);
  });

  it("the right code: the store re-reads the session and the app opens", async () => {
    const w = await render();
    await enter(w, "042917");
    expect(calls("/api/me/second-factor/verify")[0]![1]).toEqual({ method: "POST", body: { code: "042917" } });
    expect(session.loadSurfaces).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ name: "dashboard" });
  });

  it("a wrong code is said in the API's words, and nothing moves", async () => {
    replies["/api/me/second-factor/verify"] = refusal(422, "wrong_code", "That code is not right. Check the latest email and try again.");
    const w = await render();
    await enter(w, "111111");
    expect(w.get('[role="alert"]').text()).toContain("not right");
    expect(push).not.toHaveBeenCalled();
  });

  it("Send a new code: says when one went out moments ago instead of pretending", async () => {
    const w = await render();
    replies["/api/me/second-factor/code"] = { ...SENT, data: { ...SENT.data, outcome: "recent" } };
    await w.get('[data-testid="two-step-resend"]').trigger("click");
    await flushPromises();
    expect(calls("/api/me/second-factor/code")).toHaveLength(2);
    expect(w.get('[role="status"]').text()).toContain("less than a minute ago");
  });

  it("a send that failed is a Retry, not a code box", async () => {
    replies["/api/me/second-factor/code"] = refusal(429, "too_many_codes", "5 codes were sent in the last hour.");
    const w = await render();
    expect(w.find("form").exists()).toBe(false);
    expect(w.text()).toContain("5 codes were sent in the last hour.");
  });

  it("has Sign out and no way around the page", async () => {
    const w = await render();
    expect(button(w, "Back")).toBeUndefined();
    await button(w, "Sign out")!.trigger("click");
    await flushPromises();
    expect(session.signOut).toHaveBeenCalled();
  });
});

describe("a device that does not owe it", () => {
  it("sends nothing and says until when the browser is trusted, with Back", async () => {
    session.secondFactor = { ...OWED, satisfied: true, trusted_until: "2026-12-08T12:00:00.000Z" };
    const w = await render();
    expect(api.apiFetch).not.toHaveBeenCalled();
    expect(w.get('[data-testid="two-step-lead"]').text()).toContain("until");
    expect(button(w, "Back")).toBeDefined();
  });
});
