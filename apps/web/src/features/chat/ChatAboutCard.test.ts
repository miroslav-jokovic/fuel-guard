import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * "Chat about this" on a record's page (OFFICE-CHAT-PLAN CH11c, D-CHAT32–34). What a person relies on:
 *  · the card appears only for somebody who may use chat AND read that kind of record (a driver needs
 *    roster view) — never an offer the API would refuse;
 *  · it lists the viewer's own conversations about the record, each opening in /chat, and says when there
 *    are none of theirs;
 *  · Chat about this picks people and starts a GROUP named for the record, even with one person, then
 *    opens it; a refusal is said in words.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const access = vi.hoisted(() => ({ role: "dispatcher" as string, sections: null as unknown, modules: new Set(["messages"]) as Set<string> | undefined, surfaces: {} as Record<string, boolean> }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    isAuthenticated: true, userId: "11111111-1111-4111-8111-111111111111", role: access.role, sections: access.sections, surfaces: access.surfaces,
    canView: (section: string) => !(access.sections as Record<string, string> | null)?.[section] || (access.sections as Record<string, string>)[section] !== "none",
  }),
}));
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => access.modules) }) };
});

import ChatAboutCard from "./ChatAboutCard.vue";
import NewChatDialog from "./NewChatDialog.vue";

const LOAD = "44444444-4444-4444-8444-444444444444";
const T = "33333333-3333-4333-8333-333333333333";
const BEN = "22222222-2222-4222-8222-222222222222";
const ok = <T>(data: T) => ({ ok: true, status: 200, data, error: null });
const conv = { thread_id: T, subject: "Load L-20481", created_at: "2026-11-02T10:00:00Z", last_message_at: "2026-11-02T11:00:00Z", unread: 2, member_count: 3, title_members: [{ user_id: BEN, name: "Ben Admin" }] };

let router: Router;
const mounted: VueWrapper[] = [];
async function render(kind: "load" | "driver" | "vehicle" = "load") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", name: "chat", component: { template: "<div/>" } }, { path: "/", component: { template: "<div/>" } }] });
  await router.push("/");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(ChatAboutCard, { kind, recordId: LOAD, label: "L-20481" }) });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const urls = () => apiFetch.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  setActivePinia(createPinia());
  access.role = "dispatcher"; access.sections = null; access.modules = new Set(["messages"]); access.surfaces = {};
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/chat/about/")) return ok({ conversations: [conv] });
    if (path === "/api/chat/people") return ok({ people: [{ user_id: BEN, name: "Ben Admin", role: "admin" }] });
    if (path === "/api/chat/about") return ok({ thread_id: T });
    return ok({});
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  document.body.innerHTML = "";
});

describe("ChatAboutCard", () => {
  it("lists your conversations about the record, unread bold and counted, and opens one in /chat", async () => {
    const w = await render();
    expect(urls()).toContain(`/api/chat/about/load/${LOAD}`);
    const row = w.find("ul[aria-label='Conversations about this'] li button");
    expect(row.text()).toContain("Load L-20481");
    expect(row.text()).toContain("3 people");
    const name = (r: ReturnType<typeof w.find>) => r.find("span.truncate");
    expect(name(row).classes()).toContain("font-semibold");
    await row.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ c: T });
  });

  it("a conversation with nothing unread is not bold", async () => {
    apiFetch.mockImplementation(async () => ok({ conversations: [{ ...conv, unread: 0 }] }));
    const w = await render();
    const title = w.find("ul[aria-label='Conversations about this'] li span.truncate");
    expect(title.classes()).toContain("font-medium");
    expect(title.classes()).not.toContain("font-semibold");
  });

  it("says when none of the conversations are yours", async () => {
    apiFetch.mockImplementation(async () => ok({ conversations: [] }));
    const w = await render();
    expect(w.text()).toContain("None of yours yet.");
  });

  it("is not there for somebody without chat in the plan, without the Chat screen, or — for a driver — without roster view", async () => {
    access.modules = new Set();
    expect((await render()).find("[data-chat-about-card]").exists()).toBe(false);
    access.modules = new Set(["messages"]); access.surfaces = { chat: false };
    expect((await render()).find("[data-chat-about-card]").exists()).toBe(false);
    access.surfaces = {}; access.sections = { roster: "none" };
    expect((await render("driver")).find("[data-chat-about-card]").exists()).toBe(false);
    expect((await render("load")).find("[data-chat-about-card]").exists()).toBe(true);
    expect(urls().filter((u) => u.includes("/about/driver/"))).toEqual([]);
  });

  it("Chat about this starts a group named for the record with the one person picked, then opens it", async () => {
    const w = await render();
    await w.findAll("button").find((b) => b.text() === "Chat about this")!.trigger("click");
    await flushPromises();
    const dialog = w.findComponent(NewChatDialog);
    expect(dialog.props("about")).toBe("Load L-20481");
    expect(document.body.textContent).toContain("Chat about Load L-20481");
    dialog.vm.$emit("start", [BEN], "Load L-20481");
    await flushPromises();
    const create = apiFetch.mock.calls.find((c) => c[0] === "/api/chat/about")!;
    expect(create[1]).toMatchObject({ method: "POST", body: { kind: "load", record_id: LOAD, subject: "Load L-20481", member_ids: [BEN] } });
    expect(router.currentRoute.value.query).toEqual({ c: T });
  });

  it("sends the name the person typed, or the record's when they cleared it", async () => {
    const w = await render();
    await w.findAll("button").find((b) => b.text() === "Chat about this")!.trigger("click");
    w.findComponent(NewChatDialog).vm.$emit("start", [BEN], "Detention on L-20481");
    await flushPromises();
    w.findComponent(NewChatDialog).vm.$emit("start", [BEN], null);
    await flushPromises();
    const subjects = apiFetch.mock.calls.filter((c) => c[0] === "/api/chat/about").map((c) => (c[1] as { body: { subject: string } }).body.subject);
    expect(subjects).toEqual(["Detention on L-20481", "Load L-20481"]);
  });

  it("says in words when the conversation could not be started, and stays", async () => {
    const w = await render();
    apiFetch.mockImplementation(async (path: string) => (path === "/api/chat/about" ? { ok: false, status: 404, data: null, error: { message: "That load, driver or truck does not exist" } } : ok({ conversations: [], people: [] })));
    await w.findAll("button").find((b) => b.text() === "Chat about this")!.trigger("click");
    w.findComponent(NewChatDialog).vm.$emit("start", [BEN], null);
    await flushPromises();
    expect(w.find("[role='alert']").text()).toBe("That load, driver or truck does not exist");
    expect(router.currentRoute.value.path).toBe("/");
  });
});

describe("NewChatDialog about a record", () => {
  it("is a group even with one person picked, its name starting as the record's", async () => {
    const w = mount(NewChatDialog, { props: { open: false, people: [{ user_id: BEN, name: "Ben Admin", role: "admin" }], viewerId: "x", busy: false, about: "Truck 702" }, attachTo: document.body });
    mounted.push(w);
    await w.setProps({ open: true });
    await flushPromises();
    (document.body.querySelector("input[type='checkbox'], [role='option'], li button") as HTMLElement | null)?.click();
    await flushPromises();
    const name = [...document.body.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === "Truck 702") as HTMLInputElement | undefined;
    expect(name).toBeDefined();
    const startButton = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start the conversation")!;
    startButton.click();
    await flushPromises();
    expect(w.emitted("start")).toEqual([[[BEN], "Truck 702"]]);
  });
});
