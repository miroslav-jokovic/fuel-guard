import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { AppSelect } from "@silvicom/ui";
import SettingsUsersPage from "@/pages/SettingsUsersPage.vue";
import { answerConfirm } from "@silvicom/ui/testing";

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
  /** A resend rotates the link; the API says so with this flag (invites.ts, 2026-09-04). */
  rotated: false,
  /** The API refuses a suspension (the last admin, AM010 → 409). */
  refuseSuspend: false,
  /** SP9: how many writes the API refuses with `step_up_required` before the password is given. */
  stepUpRefusals: 0,
  /** Writes let through before those refusals start — a token that lapses part-way through a list. */
  stepUpAfter: 0,
  /** F2: the members / invitations read answers 500. */
  membersFail: false,
  invitesFail: false,
}));
/** Toasts are the ONLY place the rotation is told to the admin, so a test has to be able to read them. */
const toasts = vi.hoisted(() => [] as Array<{ kind: string; title: string; detail?: string }>);

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (init?.method && !path.endsWith("/mail-test") && state.stepUpAfter > 0) state.stepUpAfter -= 1;
    else if (init?.method && !path.endsWith("/mail-test") && state.stepUpRefusals > 0) {
      state.stepUpRefusals -= 1;
      return { ok: false, status: 403, error: { code: "step_up_required", message: "Confirm your password to continue." } };
    }
    if (path === "/api/members" && !init?.method && state.membersFail) return { ok: false, status: 500, error: { code: "internal", message: "relation does not exist" } };
    if (path === "/api/invites" && !init?.method && state.invitesFail) return { ok: false, status: 500, error: { code: "internal", message: "relation does not exist" } };
    if (path === "/api/members" && !init?.method) return { ok: true, data: { members: state.members } };
    if (state.refuseSuspend && path.endsWith("/suspend"))
      return { ok: false, status: 409, error: { code: "last_admin", message: "This is the only admin — promote someone else to admin first." } };
    if (path === "/api/invites" && !init?.method) return { ok: true, data: { invites: state.invites } };
    if (path === "/api/invites" && init?.method === "POST")
      return { ok: true, data: { emailSent: true, rotated: state.rotated, link: "https://app.example/accept-invite?token=abc" } };
    return { ok: true, data: {} };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "u-admin" }) }));
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({
    success: (title: string, detail?: string) => toasts.push({ kind: "success", title, detail }),
    error: (title: string, detail?: string) => toasts.push({ kind: "error", title, detail }),
  }),
}));

/** The prompt stubbed to its contract (SP9): its password round trip is `lib/stepUp.ts`'s, not the page's. */
const StepUpStub = {
  template: "<div data-test='step-up'>{{ reason }}<button data-test='step-up-ok' @click=\"$emit('confirmed')\">ok</button></div>",
  props: ["reason"],
  emits: ["confirmed", "cancel"],
};
const stubs = { PageHeader: { template: "<div />" }, RouterLink: { template: "<a><slot /></a>" }, StepUpPrompt: StepUpStub };
/** One member's row — a `<tr>` on a desktop, a card `<li>` on a phone; jsdom renders the cards. */
const rowOf = (w: ReturnType<typeof mountPage>, email: string) =>
  w.findAll("tbody tr, ul > li").find((r) => r.text().includes(email))!;
/**
 * A REAL router since D-US2: the members search lives in the URL through `useQueryState`, which
 * awaits `router.replace`. The URL is set on the HISTORY rather than pushed, so the helper stays
 * synchronous: the router's own first navigation (on install) lands on it, and every test already
 * flushes promises after mounting, which settles that navigation.
 */
let router: Router;
/** The page's Pinia, shared with `answerConfirm` so the confirm dialog's answer is the one the page reads (D-US7). */
let pinia: Pinia;
const mountPage = (url = "/settings/users") => {
  const history = createMemoryHistory();
  history.replace(url);
  router = createRouter({ history, routes: [{ path: "/:any(.*)*", component: { template: "<div />" } }] });
  // The lists are queries since F2; no retries, so a failed read is a failure on the first answer.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(SettingsUsersPage, {
    global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]], stubs },
    attachTo: document.body,
  });
};

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  calls.length = 0;
  toasts.length = 0;
  state.rotated = false;
  state.refuseSuspend = false;
  state.stepUpRefusals = 0;
  state.stepUpAfter = 0;
  state.membersFail = false;
  state.invitesFail = false;
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
    // ⚠ The link shape is OUR token since 2026-09-04, not GoTrue's `token_hash=…&type=invite`; this
    // fixture carried the old one because the change predates that merge. `inviteDelivery.ts` builds
    // `/accept-invite?token=<our token>`, and a fixture showing a shape the product cannot produce is
    // the trap `testEnv` exists for one layer down.
    expect(w.text()).toContain("token=abc");
    expect(w.findAll("button").some((b) => b.text() === "Copy")).toBe(true);
    // …and the wording is not the failure wording.
    expect(w.text()).not.toContain("didn't go out");
    w.unmount();
  });

  // ⚠ Added while resolving this branch against main. A resend ROTATES the link (2026-09-04), and
  // main's wording for that was reachable by no test at all — mutating it away left every case green.
  // It is the only thing that tells an admin which of two identical-looking emails still works, which
  // is how an invitation was lost in the first place.
  it("says a resend rotated the link, so the admin knows the earlier one is dead", async () => {
    state.rotated = true;
    const w = mountPage();
    await flushPromises();
    const form = w.find("form");
    await form.find('input[type="text"]').setValue("Vinnie Dispatcher");
    await form.find('input[type="email"]').setValue("vinnie@silvicominc.test");
    await form.trigger("submit");
    await flushPromises();
    const sent = toasts.filter((t) => t.kind === "success").at(-1)!;
    expect(sent.title).toBe("New invitation emailed");
    expect(sent.detail).toContain("the earlier link no longer works");
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

/**
 * SP7 + Q-SET12 (a): an office member can be suspended and reinstated from the row's menu, the list
 * says who is suspended, and every access act confirms what it does — including, since Q-SET6 (a),
 * that the person is signed out at once.
 */
describe("SettingsUsersPage — suspend, reinstate, remove", () => {
  let confirmSpy: ReturnType<typeof answerConfirm>;
  beforeEach(() => {
    confirmSpy = answerConfirm(true, pinia);
    state.members = [
      { userId: "u-admin", email: "boss@silvicom.test", fullName: "Miki Boss", role: "admin", joinedAt: "2026-01-01T00:00:00Z", suspendedAt: null },
      // No `suspendedAt` at all — an API on the previous build. Absence must read as active.
      { userId: "u-tech", email: "shop@silvicom.test", fullName: "Shop Lead", role: "technician", joinedAt: "2026-01-02T00:00:00Z" },
      { userId: "u-leave", email: "leave@silvicom.test", fullName: "On Leave", role: "dispatcher", joinedAt: "2026-01-03T00:00:00Z", suspendedAt: "2026-09-30T12:00:00Z" },
      // A driver-app login, which the API filters out today; the page must not depend on that.
      { userId: "u-driver", email: "aaron@drivers.test", fullName: "Aaron R", role: "driver", joinedAt: "2026-01-04T00:00:00Z", suspendedAt: null },
    ];
  });

  /** Open a row's kebab and list the items it rendered (the popover renders outside the row). */
  async function menuOf(w: ReturnType<typeof mountPage>, email: string): Promise<string[]> {
    await rowOf(w, email).find("button").trigger("click");
    await flushPromises();
    return [...document.querySelectorAll("button.kebab-item")].map((b) => b.textContent!.trim());
  }
  const pick = async (label: string) => {
    [...document.querySelectorAll<HTMLButtonElement>("button.kebab-item")].find((b) => b.textContent!.trim() === label)!.click();
    await flushPromises();
  };

  it("badges a suspended member, and nobody else", async () => {
    const w = mountPage();
    await flushPromises();
    expect(rowOf(w, "leave@silvicom.test").text()).toContain("Suspended");
    expect(rowOf(w, "shop@silvicom.test").text()).not.toContain("Suspended");
    expect(rowOf(w, "boss@silvicom.test").text()).not.toContain("Suspended");
    w.unmount();
  });

  it("offers Suspend on an active member and Reinstate on a suspended one", async () => {
    const w = mountPage();
    await flushPromises();
    const active = await menuOf(w, "shop@silvicom.test");
    expect(active).toContain("Suspend member…");
    expect(active).not.toContain("Reinstate member…");
    w.unmount();
    const w2 = mountPage();
    await flushPromises();
    const held = await menuOf(w2, "leave@silvicom.test");
    expect(held).toContain("Reinstate member…");
    expect(held).not.toContain("Suspend member…");
    w2.unmount();
  });

  it("offers no access act on yourself, or on a driver-app login", async () => {
    const w = mountPage();
    await flushPromises();
    const self = await menuOf(w, "boss@silvicom.test");
    expect(self.filter((l) => /Suspend|Reinstate|Remove/.test(l))).toEqual([]);
    w.unmount();
    const w2 = mountPage();
    await flushPromises();
    const driver = await menuOf(w2, "aaron@drivers.test");
    expect(driver.filter((l) => /Suspend|Reinstate|Remove/.test(l))).toEqual([]);
    w2.unmount();
  });

  it("suspends after a confirmation that says they are signed out now and keep their permissions", async () => {
    const w = mountPage();
    await flushPromises();
    await menuOf(w, "shop@silvicom.test");
    await pick("Suspend member…");
    const asked = confirmSpy.mock.calls.at(-1)![0];
    expect(asked).toMatchObject({ title: "Suspend Shop Lead?", confirmLabel: "Suspend", tone: "danger" });
    expect(asked.message).toContain("signed out now");
    expect(asked.message).toContain("personal permissions are kept");
    expect(calls.find((c) => c.path === "/api/members/u-tech/suspend")?.init?.method).toBe("POST");
    expect(calls.filter((c) => c.path === "/api/members" && !c.init?.method).length).toBeGreaterThanOrEqual(2);
    w.unmount();
  });

  it("sends nothing when the admin cancels the confirmation", async () => {
    answerConfirm(false, pinia);
    const w = mountPage();
    await flushPromises();
    await menuOf(w, "shop@silvicom.test");
    await pick("Suspend member…");
    expect(calls.some((c) => c.path.endsWith("/suspend"))).toBe(false);
    w.unmount();
  });

  it("reinstates after a confirmation that says their permissions come back", async () => {
    const w = mountPage();
    await flushPromises();
    await menuOf(w, "leave@silvicom.test");
    await pick("Reinstate member…");
    const asked = confirmSpy.mock.calls.at(-1)![0];
    // Reinstating gives access back: the ordinary button, not the red one.
    expect(asked).toMatchObject({ title: "Reinstate On Leave?", confirmLabel: "Reinstate" });
    expect(asked.tone).toBeUndefined();
    expect(asked.message).toContain("personal permissions they had before");
    expect(calls.find((c) => c.path === "/api/members/u-leave/reinstate")?.init?.method).toBe("POST");
    w.unmount();
  });

  it("confirms a removal by saying they are signed out immediately, then DELETEs", async () => {
    const w = mountPage();
    await flushPromises();
    await menuOf(w, "shop@silvicom.test");
    await pick("Remove member…");
    const asked = confirmSpy.mock.calls.at(-1)![0];
    expect(asked).toMatchObject({ title: "Remove Shop Lead from the organization?", confirmLabel: "Remove member", tone: "danger" });
    expect(asked.message).toContain("signed out immediately");
    expect(calls.find((c) => c.path === "/api/members/u-tech")?.init?.method).toBe("DELETE");
    w.unmount();
  });

  it("reports a refused suspension instead of announcing it", async () => {
    state.refuseSuspend = true;
    const w = mountPage();
    await flushPromises();
    await menuOf(w, "shop@silvicom.test");
    await pick("Suspend member…");
    expect(toasts.some((t) => t.kind === "success" && t.title === "Member suspended")).toBe(false);
    expect(toasts.at(-1)).toMatchObject({ kind: "error", title: "Could not suspend member" });
    w.unmount();
  });
});

/**
 * SP9 (Q-SET8 (a), ruled 2026-09-30): every write on this page is refused without the password
 * step-up. What only the page decides is that the refusal becomes the password prompt — never a
 * "Could not …" toast — and that the SAME write goes out again once the password is confirmed,
 * without the admin clicking twice or being asked "are you sure?" twice.
 */
describe("SettingsUsersPage — a write asks for the password, then happens", () => {
  let confirmSpy: ReturnType<typeof answerConfirm>;
  beforeEach(() => {
    confirmSpy = answerConfirm(true, pinia);
  });

  const prompt = () => document.querySelector("[data-test='step-up']");
  const confirmPassword = async () => {
    document.querySelector<HTMLButtonElement>("[data-test='step-up-ok']")!.click();
    await flushPromises();
  };
  const sent = (path: string, method: string) => calls.filter((c) => c.path === path && c.init?.method === method);

  it("a suspension refused for step-up shows the prompt, then is sent again — confirmed once", async () => {
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    await rowOf(w, "shop@silvicom.test").find("button").trigger("click");
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>("button.kebab-item")].find((b) => b.textContent!.trim() === "Suspend member…")!.click();
    await flushPromises();
    expect(prompt()?.textContent).toContain("Confirm your password");
    expect(toasts.filter((t) => t.kind === "error")).toEqual([]);

    await confirmPassword();
    expect(sent("/api/members/u-tech/suspend", "POST")).toHaveLength(2);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Member suspended" });
    expect(prompt()).toBeNull();
    w.unmount();
  });

  it("an invitation refused for step-up shows the prompt, then is sent again with what was typed", async () => {
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    const form = w.find("form");
    await form.find('input[type="text"]').setValue("Jane Dispatcher");
    await form.find('input[type="email"]').setValue("jane@silvicom.test");
    await form.trigger("submit");
    await flushPromises();
    expect(prompt()).not.toBeNull();
    expect(toasts.filter((t) => t.kind === "error")).toEqual([]);

    await confirmPassword();
    const posts = sent("/api/invites", "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.init?.body).toEqual({ email: "jane@silvicom.test", role: "dispatcher", fullName: "Jane Dispatcher" });
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Invitation emailed" });
    w.unmount();
  });

  it("revoking an invitation refused for step-up is sent again after the password", async () => {
    state.invites = [{ id: "inv-1", email: "vinnie@silvicom.test", role: "dispatcher", status: "pending", full_name: null }];
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    await rowOf(w, "vinnie@silvicom.test").find("button").trigger("click");
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>("button.kebab-item")].find((b) => b.textContent!.trim() === "Revoke invite")!.click();
    await flushPromises();
    expect(prompt()).not.toBeNull();
    await confirmPassword();
    expect(sent("/api/invites/inv-1/revoke", "POST")).toHaveLength(2);
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Invitation revoked" });
    w.unmount();
  });

  it("a rename refused for step-up asks inside its own drawer, then saves the same name", async () => {
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    await rowOf(w, "shop@silvicom.test").find("button").trigger("click");
    await flushPromises();
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add name")!.click();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("#rename-member input")!;
    input.value = "Shop Lead";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLFormElement>("#rename-member")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();
    expect(prompt()).not.toBeNull();
    expect(document.querySelector("#rename-member")).toBeNull();

    await confirmPassword();
    const patches = sent("/api/members/u-tech", "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.init?.body).toEqual({ fullName: "Shop Lead" });
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Name updated" });
    w.unmount();
  });

  it("a role change refused for step-up is sent again after the password", async () => {
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    const picker = rowOf(w, "shop@silvicom.test").findComponent(AppSelect);
    picker.vm.$emit("update:modelValue", "dispatcher");
    await flushPromises();
    expect(prompt()).not.toBeNull();
    expect(toasts.filter((t) => t.kind === "error")).toEqual([]);

    await confirmPassword();
    const patches = sent("/api/members/u-tech", "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.init?.body).toEqual({ role: "dispatcher" });
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Role updated" });
    w.unmount();
  });

  it("a bulk removal whose token lapses part-way resumes from the refused member, and reports one tally", async () => {
    state.members.push({ userId: "u-disp", email: "desk@silvicom.test", fullName: "Desk", role: "dispatcher", joinedAt: "2026-01-03T00:00:00Z" });
    // The first DELETE goes through, the second is refused: the retry must not remove the first twice.
    state.stepUpAfter = 1;
    state.stepUpRefusals = 1;
    const w = mountPage();
    await flushPromises();
    for (const email of ["shop@silvicom.test", "desk@silvicom.test"]) {
      await rowOf(w, email).find('input[type="checkbox"]').setValue(true);
    }
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Remove")!.trigger("click");
    await flushPromises();
    expect(prompt()).not.toBeNull();

    await confirmPassword();
    expect(sent("/api/members/u-tech", "DELETE")).toHaveLength(1);
    expect(sent("/api/members/u-disp", "DELETE")).toHaveLength(2);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "2 members removed" });
    w.unmount();
  });
});

describe("SettingsUsersPage — members list composition", () => {
  it("searches members from the shared FilterBar and counts what is left", async () => {
    const w = mountPage();
    await flushPromises();
    const search = w.find<HTMLInputElement>('input[placeholder="Search members…"]');
    expect(search.exists()).toBe(true);
    expect(w.text()).toContain("2 members");

    await search.setValue("shop@");
    // AppSearchField debounces its emit by 250 ms; the list filters on the emitted value.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(w.text()).toContain("1 member");
    expect(rowOf(w, "shop@silvicom.test")).toBeDefined();
    expect(rowOf(w, "boss@silvicom.test")).toBeUndefined();
    w.unmount();
  });
});

/** D-US2: the members search is the URL, so a reload or Back keeps the member the admin was looking at. */
describe("SettingsUsersPage — the members search in the URL (D-US2)", () => {
  it("reads a pasted ?search= into the list, and writes a new search back", async () => {
    const w = mountPage("/settings/users?search=shop");
    await flushPromises();
    expect(rowOf(w, "shop@silvicom.test")).toBeDefined();
    expect(rowOf(w, "boss@silvicom.test")).toBeUndefined();

    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "boss");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ search: "boss" });
    expect(rowOf(w, "boss@silvicom.test")).toBeDefined();
    expect(rowOf(w, "shop@silvicom.test")).toBeUndefined();
    w.unmount();
  });
});

/**
 * D-US7: the three questions the page asks itself — deleting an invitation, removing several members,
 * demoting yourself — go through the product's confirm, and a "no" sends nothing.
 */
describe("SettingsUsersPage — the page's own confirmations (D-US7)", () => {
  const sent = (path: string, method: string) => calls.filter((c) => c.path === path && c.init?.method === method);
  const deleteInvite = async (w: ReturnType<typeof mountPage>) => {
    await rowOf(w, "old@silvicom.test").find("button").trigger("click");
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>("button.kebab-item")].find((b) => b.textContent!.trim() === "Delete invite")!.click();
    await flushPromises();
  };
  beforeEach(() => {
    state.invites = [{ id: "inv-9", email: "old@silvicom.test", role: "dispatcher", status: "expired", full_name: null }];
  });

  it("deleting an invitation asks a red question naming the address, and a no deletes nothing", async () => {
    const spy = answerConfirm(false, pinia);
    const w = mountPage();
    await flushPromises();
    await deleteInvite(w);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Delete the invitation for old@silvicom.test?", confirmLabel: "Delete invitation", tone: "danger" }),
    );
    expect(sent("/api/invites/inv-9", "DELETE")).toHaveLength(0);
    w.unmount();
  });

  it("deleting an invitation, answered yes, sends the DELETE", async () => {
    answerConfirm(true, pinia);
    const w = mountPage();
    await flushPromises();
    await deleteInvite(w);
    expect(sent("/api/invites/inv-9", "DELETE")).toHaveLength(1);
    expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Invitation deleted" });
    w.unmount();
  });

  it("a bulk removal asks how many, in red, and a no removes nobody", async () => {
    const spy = answerConfirm(false, pinia);
    const w = mountPage();
    await flushPromises();
    await rowOf(w, "shop@silvicom.test").find('input[type="checkbox"]').setValue(true);
    await w.findAll("button").find((b) => b.text() === "Remove")!.trigger("click");
    await flushPromises();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove 1 member?", confirmLabel: "Remove 1 member", tone: "danger" }));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    w.unmount();
  });

  it("demoting yourself asks first; a no sends nothing and reloads so the picker snaps back", async () => {
    const spy = answerConfirm(false, pinia);
    const w = mountPage();
    await flushPromises();
    const loadsBefore = calls.filter((c) => c.path === "/api/members" && !c.init?.method).length;
    rowOf(w, "boss@silvicom.test").findComponent(AppSelect).vm.$emit("update:modelValue", "dispatcher");
    await flushPromises();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: "Change your own role?", confirmLabel: "Change my role", tone: "danger" }));
    expect(sent("/api/members/u-admin", "PATCH")).toHaveLength(0);
    expect(calls.filter((c) => c.path === "/api/members" && !c.init?.method).length).toBe(loadsBefore + 1);
    w.unmount();
  });

  it("demoting yourself, answered yes, sends the role", async () => {
    answerConfirm(true, pinia);
    const w = mountPage();
    await flushPromises();
    rowOf(w, "boss@silvicom.test").findComponent(AppSelect).vm.$emit("update:modelValue", "dispatcher");
    await flushPromises();
    expect(sent("/api/members/u-admin", "PATCH")[0]?.init?.body).toEqual({ role: "dispatcher" });
    w.unmount();
  });

  it("changing someone else's role asks nothing", async () => {
    const spy = answerConfirm(true, pinia);
    const w = mountPage();
    await flushPromises();
    rowOf(w, "shop@silvicom.test").findComponent(AppSelect).vm.$emit("update:modelValue", "dispatcher");
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
    expect(sent("/api/members/u-tech", "PATCH")).toHaveLength(1);
    w.unmount();
  });
});

/** D-US8: the members list pages twenty at a time, the page in the URL beside the search (D-US2). */
describe("SettingsUsersPage — the members list pages (D-US8)", () => {
  beforeEach(() => {
    state.members = Array.from({ length: 45 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return { userId: `u-${n}`, email: `m${n}@silvicom.test`, fullName: `Member ${n}`, role: "dispatcher", joinedAt: "2026-01-01T00:00:00Z" };
    });
  });

  it("a pasted ?page=2 shows members 21–40", async () => {
    const w = mountPage("/settings/users?page=2");
    await flushPromises();
    expect(rowOf(w, "m21@silvicom.test")).toBeDefined();
    expect(rowOf(w, "m40@silvicom.test")).toBeDefined();
    expect(rowOf(w, "m20@silvicom.test")).toBeUndefined();
    expect(rowOf(w, "m41@silvicom.test")).toBeUndefined();
    expect(w.text()).toMatch(/Showing\s*21\s*–\s*40\s*of\s*45/);
    w.unmount();
  });

  it("a new search returns the list to page 1", async () => {
    const w = mountPage("/settings/users?page=2");
    await flushPromises();
    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "Member");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ search: "Member" });
    expect(rowOf(w, "m01@silvicom.test")).toBeDefined();
    w.unmount();
  });
});

/**
 * F2 (US6b): a failed read is a failure, not an empty organization. Before, both lists were refs that
 * started empty, so a 500 drew "0 members · No members match" and "No invitations yet" with only a
 * toast to say otherwise.
 */
describe("SettingsUsersPage — a failed read", () => {
  const reads = (path: string) => calls.filter((c) => c.path === path && !c.init?.method).length;

  it("says the members could not be loaded, prints no count, and Retry asks again", async () => {
    state.membersFail = true;
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain("Could not load the members.");
    expect(w.text()).not.toContain("No members match");
    expect(w.text()).not.toMatch(/\b0 members\b/);
    expect(w.text()).not.toContain("relation does not exist");
    const before = reads("/api/members");
    state.membersFail = false;
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    await flushPromises();
    expect(reads("/api/members")).toBe(before + 1);
    expect(w.text()).toContain("boss@silvicom.test");
  });

  it("says the invitations could not be loaded instead of \"No invitations yet\"", async () => {
    state.invitesFail = true;
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain("Could not load the invitations.");
    expect(w.text()).not.toContain("No invitations yet");
    const before = reads("/api/invites");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    await flushPromises();
    expect(reads("/api/invites")).toBe(before + 1);
  });
});
