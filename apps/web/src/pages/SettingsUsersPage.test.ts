import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsUsersPage from "@/pages/SettingsUsersPage.vue";

/**
 * The Users page after 0301 (S9): members have names.
 *
 * What is pinned is what the page SENDS and what it SAYS about a name — the Name column with its
 * honest empty state, the invitation carrying the name the admin typed, and the rename drawer
 * writing exactly `{ fullName }` to the member endpoint. The transport is mocked; the table, the
 * drawer and the kebab are the shipped components.
 */
const calls = vi.hoisted(() => [] as Array<{ path: string; init?: { method?: string; body?: unknown } }>);
const state = vi.hoisted(() => ({
  members: [] as unknown[],
  invites: [] as unknown[],
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path === "/api/members" && !init?.method) return { ok: true, data: { members: state.members } };
    if (path === "/api/invites" && !init?.method) return { ok: true, data: { invites: state.invites } };
    if (path === "/api/invites" && init?.method === "POST") return { ok: true, data: { emailSent: true, link: "https://app.example/accept-invite?token_hash=abc&type=invite" } };
    return { ok: true, data: {} };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "u-admin" }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const stubs = { PageHeader: { template: "<div />" }, RouterLink: { template: "<a><slot /></a>" } };
/** One member's row — a `<tr>` on a desktop, a card `<li>` on a phone; jsdom renders the cards. */
const rowOf = (w: ReturnType<typeof mountPage>, email: string) =>
  w.findAll("tbody tr, ul > li").find((r) => r.text().includes(email))!;
const mountPage = () =>
  mount(SettingsUsersPage, { global: { plugins: [createPinia()], stubs }, attachTo: document.body });

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  document.body.innerHTML = "";
  state.members = [
    { userId: "u-admin", email: "boss@silvicom.test", fullName: "Miki Boss", role: "admin", joinedAt: "2026-01-01T00:00:00Z" },
    { userId: "u-tech", email: "shop@silvicom.test", fullName: null, role: "technician", joinedAt: "2026-01-02T00:00:00Z" },
  ];
  state.invites = [];
});

describe("SettingsUsersPage — names", () => {
  it("shows each member's name first, and says plainly when there is none yet", async () => {
    const w = mountPage();
    await flushPromises();
    const boss = rowOf(w, "boss@silvicom.test");
    const tech = rowOf(w, "shop@silvicom.test");
    expect(boss.text()).toContain("Miki Boss");
    expect(tech.text()).toContain("No name yet");
    w.unmount();
  });

  it("sends the invitee's name with the invitation", async () => {
    const w = mountPage();
    await flushPromises();
    const form = w.find("form");
    await form.find('input[type="text"]').setValue("  Jane Dispatcher ");
    await form.find('input[type="email"]').setValue("jane@silvicom.test");
    await form.trigger("submit");
    await flushPromises();
    const post = calls.find((c) => c.path === "/api/invites" && c.init?.method === "POST")!;
    expect(post.init?.body).toEqual({ email: "jane@silvicom.test", role: "dispatcher", fullName: "Jane Dispatcher" });
    w.unmount();
  });

  it("keeps the accept link on screen after a SUCCESSFUL send, so a delivered-but-unseen invite has a way in", async () => {
    const w = mountPage();
    await flushPromises();
    const form = w.find("form");
    await form.find('input[type="text"]').setValue("Vinnie Dispatcher");
    await form.find('input[type="email"]').setValue("vinnie@silvicominc.test");
    await form.trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("Emailed to vinnie@silvicominc.test");
    expect(w.text()).toContain("token_hash=abc");
    expect(w.findAll("button").some((b) => b.text() === "Copy")).toBe(true);
    // …and the wording is not the failure wording.
    expect(w.text()).not.toContain("didn't go out");
    w.unmount();
  });

  it("renames a member from the drawer with exactly the name typed, and reloads", async () => {
    const w = mountPage();
    await flushPromises();
    const tech = rowOf(w, "shop@silvicom.test");
    // The kebab is a popover: open it, then pick "Add name" wherever it rendered.
    await tech.find("button").trigger("click");
    await flushPromises();
    const add = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add name")!;
    expect(add, "the row offers to add a name").toBeTruthy();
    add.click();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("#rename-member input")!;
    expect(input, "the drawer opened with a name field").toBeTruthy();
    input.value = "  Shop Lead ";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLFormElement>("#rename-member")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();
    const patch = calls.find((c) => c.path === "/api/members/u-tech" && c.init?.method === "PATCH")!;
    expect(patch.init?.body).toEqual({ fullName: "Shop Lead" });
    // A successful rename reloads the list rather than editing the row by hand.
    expect(calls.filter((c) => c.path === "/api/members" && !c.init?.method).length).toBeGreaterThanOrEqual(2);
    w.unmount();
  });
});
